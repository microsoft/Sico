package providers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/require"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/shared/enum"
	"sico-backend/internal/transport/http/middleware"
	"sico-backend/pkg/jwtx"
)

func TestMain(m *testing.M) {
	_ = os.Setenv(sandboxServiceTokenEnv, strings.Repeat("a", 64))
	os.Exit(m.Run())
}

type emulatorRoutePool struct {
	resource     *sandboximpl.Resource
	resolveCalls atomic.Int32
}

type emulatorRouteAuthorizer struct {
	resourceErr error
	providerErr error
}

func (a emulatorRouteAuthorizer) AuthorizeResourceProxy(
	context.Context,
	*sandboximpl.Resource,
) error {
	return a.resourceErr
}

func (a emulatorRouteAuthorizer) AuthorizeSandboxProviderOperation(context.Context) error {
	return a.providerErr
}

func (p *emulatorRoutePool) ResolveResourceByHash(
	context.Context,
	string,
	string,
) (*sandboximpl.Resource, error) {
	p.resolveCalls.Add(1)
	return p.resource, nil
}

func (*emulatorRoutePool) UpdateResolvedResourceCache(context.Context, *sandboximpl.Resource) error {
	return nil
}

func TestPublicFactoryIncludesEmulatorAndLinuxWorkstationProviders(t *testing.T) {
	t.Setenv(sandboxServiceTokenEnv, strings.Repeat("a", 64))
	t.Setenv(sandboxLinuxWorkstationK8sEnabled, "false")
	providers := (publicFactory{}).Providers()
	require.Len(t, providers, 2)
	require.Equal(t, enum.SandboxTypeEmulator.String(), providers[0].Type())
	require.Equal(t, enum.SandboxTypeLinuxWorkstation.String(), providers[1].Type())
}

func TestPublicIntegrationRegistersEmulatorRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	providers := []sandboximpl.Provider{&EmulatorProvider{}}
	integration := (publicFactory{}).NewIntegration(providers, nil, nil)
	engine := gin.New()
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))

	routes := engine.Routes()
	uniquePaths := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		uniquePaths[route.Path] = struct{}{}
	}
	require.Len(t, uniquePaths, 3)
	require.Contains(t, uniquePaths, "/api/sico/sandbox/resources/emulator/:rid/vnc")
	require.Contains(t, uniquePaths, "/api/sico/sandbox/resources/emulator/:rid/ws/h264")
	require.Contains(t, uniquePaths, "/api/sico/sandbox/resources/emulator/:rid/api/*path")

	request := httptest.NewRequest(http.MethodGet, "/api/sico/sandbox/resources/emulator/resource/vnc", nil)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	require.True(t, strings.HasPrefix(response.Body.String(), "<!doctype html>"))
	require.Contains(t, response.Body.String(), `"/api/sico/sandbox/resources/emulator/resource/ws/h264"`)
	require.Contains(t, response.Body.String(), "sico.accessToken")
	require.Contains(t, response.Body.String(), "type: 'auth'")
	require.NotContains(t, response.Body.String(), strings.Repeat("a", 64))
	require.NotContains(t, response.Body.String(), "Copyright (c)")
	require.NotContains(t, response.Body.String(), "__WS_PATH__")
}

func TestEmulatorProviderResourceAPIProxy(t *testing.T) {
	serviceToken := strings.Repeat("a", 64)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "/api/v1/emulators/3/settings", request.URL.Path)
		require.Equal(t, "value", request.URL.Query().Get("key"))
		require.Empty(t, request.Header.Get("X-Sico-Token"))
		require.Equal(t, "Bearer "+serviceToken, request.Header.Get("Authorization"))
		_, _ = response.Write([]byte("proxied"))
	}))
	defer upstream.Close()

	provider := &EmulatorProvider{serviceToken: serviceToken}
	integration := &publicIntegration{
		providers: []sandboximpl.Provider{provider},
		pool: &emulatorRoutePool{resource: &sandboximpl.Resource{
			Type: provider.Type(), ResourceID: upstream.URL + "|3",
		}},
		authorizer: emulatorRouteAuthorizer{
			providerErr: apperr.New(errcode.CommonForbidden, "platform permission required"),
		},
	}
	engine := gin.New()
	engine.Use(func(ctx *gin.Context) {
		if ctx.GetHeader("X-Test-User") != "" {
			ctx.Request = ctx.Request.WithContext(context.WithValue(
				ctx.Request.Context(),
				middleware.ContextUserKey,
				middleware.UserInfo{Name: "operator@example.com"},
			))
		}
		ctx.Next()
	})
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	defer proxyServer.Close()
	request, err := http.NewRequest(
		http.MethodGet,
		proxyServer.URL+
			"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/3/settings?key=value",
		nil,
	)
	require.NoError(t, err)
	request.Header.Set("X-Sico-Token", "secret")
	unauthorizedResponse, err := http.DefaultClient.Do(request.Clone(context.Background()))
	require.NoError(t, err)
	_ = unauthorizedResponse.Body.Close()
	require.Equal(t, http.StatusUnauthorized, unauthorizedResponse.StatusCode)

	request.Header.Set("X-Test-User", "operator@example.com")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, "proxied", string(body))
}

func TestEmulatorProviderResourceAPIProxyDeniesOtherResourceAndProviderOperations(t *testing.T) {
	upstreamCalls := atomic.Int32{}
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		upstreamCalls.Add(1)
	}))
	defer upstream.Close()

	provider := &EmulatorProvider{serviceToken: strings.Repeat("a", 64)}
	integration := &publicIntegration{
		providers: []sandboximpl.Provider{provider},
		pool: &emulatorRoutePool{resource: &sandboximpl.Resource{
			Type: provider.Type(), ResourceID: upstream.URL + "|3",
			Metadata: map[string]string{"adbPort": "16387"},
		}},
		authorizer: emulatorRouteAuthorizer{
			providerErr: apperr.New(errcode.CommonForbidden, "platform permission required"),
		},
	}
	engine := gin.New()
	engine.Use(addEmulatorTestUser)
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))

	paths := []string{
		"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/4/adb/shell",
		"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/3/clone",
		"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/apps/list-batch",
		"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/port-forward/status",
		"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/port-forward?serial=host:16387",
		"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/port-forward?serial=host:16388",
	}
	for _, path := range paths {
		request := httptest.NewRequest(http.MethodPost, path, nil)
		request.Header.Set("X-Test-User", "operator@example.com")
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		require.Equal(t, http.StatusForbidden, response.Code, path)
	}
	require.Zero(t, upstreamCalls.Load())
}

func TestEmulatorProviderResourceAPIProxyAllowsPlatformProviderOperation(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "/api/v1/emulators/port-forward/status", request.URL.Path)
		response.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	provider := &EmulatorProvider{serviceToken: strings.Repeat("a", 64)}
	integration := &publicIntegration{
		providers: []sandboximpl.Provider{provider},
		pool: &emulatorRoutePool{resource: &sandboximpl.Resource{
			Type: provider.Type(), ResourceID: upstream.URL + "|3",
		}},
		authorizer: emulatorRouteAuthorizer{},
	}
	engine := gin.New()
	engine.Use(addEmulatorTestUser)
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	defer proxyServer.Close()
	request, err := http.NewRequest(
		http.MethodGet,
		proxyServer.URL+
			"/api/sico/sandbox/resources/emulator/resource/api/v1/emulators/port-forward/status",
		nil,
	)
	require.NoError(t, err)
	request.Header.Set("X-Test-User", "operator@example.com")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer func() { _ = response.Body.Close() }()
	require.Equal(t, http.StatusOK, response.StatusCode)
}

func addEmulatorTestUser(ctx *gin.Context) {
	if ctx.GetHeader("X-Test-User") != "" {
		ctx.Request = ctx.Request.WithContext(context.WithValue(
			ctx.Request.Context(),
			middleware.ContextUserKey,
			middleware.UserInfo{Name: ctx.GetHeader("X-Test-User")},
		))
	}
	ctx.Next()
}

func TestEmulatorProviderH264ProxyAuthenticatesBothHops(t *testing.T) {
	serviceToken := strings.Repeat("a", 64)
	upstreamAuthenticated := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "/api/v1/devices/3/ws/h264", request.URL.Path)
		require.Equal(t, "Bearer "+serviceToken, request.Header.Get("Authorization"))
		connection, err := (&websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}).
			Upgrade(response, request, nil)
		require.NoError(t, err)
		defer func() { _ = connection.Close() }()
		upstreamAuthenticated <- struct{}{}
		_, _, _ = connection.ReadMessage()
	}))
	defer upstream.Close()

	provider := &EmulatorProvider{serviceToken: serviceToken}
	integration := &publicIntegration{
		providers: []sandboximpl.Provider{provider},
		pool: &emulatorRoutePool{resource: &sandboximpl.Resource{
			Type: provider.Type(), ResourceID: upstream.URL + "|3",
		}},
		authorizer: emulatorRouteAuthorizer{},
	}
	engine := gin.New()
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	defer proxyServer.Close()

	auth := jwtx.New(nil)
	tokenInfo, err := auth.GenerateToken(context.Background(), &jwtx.UserInfo{Name: "operator@example.com"})
	require.NoError(t, err)
	websocketURL := "ws" + strings.TrimPrefix(proxyServer.URL, "http") +
		"/api/sico/sandbox/resources/emulator/resource/ws/h264"
	connection, response, err := websocket.DefaultDialer.Dial(
		websocketURL,
		http.Header{"Origin": []string{proxyServer.URL}},
	)
	if response != nil {
		defer func() { _ = response.Body.Close() }()
	}
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	require.NoError(t, connection.WriteJSON(websocketAuthMessage{
		Type: "auth", Token: tokenInfo.GetAccessToken(),
	}))

	select {
	case <-upstreamAuthenticated:
	case <-time.After(2 * time.Second):
		t.Fatal("Emulator upstream did not receive an authenticated WebSocket handshake")
	}
}

func TestEmulatorProviderH264AuthenticatesBeforeResourceLookup(t *testing.T) {
	provider := &EmulatorProvider{}
	pool := &emulatorRoutePool{resource: &sandboximpl.Resource{Type: provider.Type()}}
	integration := &publicIntegration{
		providers:  []sandboximpl.Provider{provider},
		pool:       pool,
		authorizer: emulatorRouteAuthorizer{},
	}
	engine := gin.New()
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	defer proxyServer.Close()

	websocketURL := "ws" + strings.TrimPrefix(proxyServer.URL, "http") +
		"/api/sico/sandbox/resources/emulator/resource/ws/h264"
	connection, response, err := websocket.DefaultDialer.Dial(
		websocketURL,
		http.Header{"Origin": []string{proxyServer.URL}},
	)
	if response != nil {
		defer func() { _ = response.Body.Close() }()
	}
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	require.NoError(t, connection.WriteJSON(websocketAuthMessage{Type: "invalid"}))
	_, _, err = connection.ReadMessage()
	require.Error(t, err)
	require.Zero(t, pool.resolveCalls.Load())
}

func TestEmulatorProviderResourceAuthorizationDeniesBeforeUpstream(t *testing.T) {
	serviceToken := strings.Repeat("a", 64)
	upstreamCalled := make(chan struct{}, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		upstreamCalled <- struct{}{}
	}))
	defer upstream.Close()

	provider := &EmulatorProvider{serviceToken: serviceToken}
	integration := &publicIntegration{
		providers: []sandboximpl.Provider{provider},
		pool: &emulatorRoutePool{resource: &sandboximpl.Resource{
			Type: provider.Type(), ResourceID: upstream.URL + "|3",
		}},
		authorizer: emulatorRouteAuthorizer{
			resourceErr: apperr.New(errcode.CommonForbidden, "denied"),
		},
	}
	engine := gin.New()
	engine.Use(func(ctx *gin.Context) {
		ctx.Request = ctx.Request.WithContext(context.WithValue(
			ctx.Request.Context(),
			middleware.ContextUserKey,
			middleware.UserInfo{Name: "operator@example.com"},
		))
		ctx.Next()
	})
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	defer proxyServer.Close()

	response, err := http.Get(
		proxyServer.URL + "/api/sico/sandbox/resources/emulator/resource/api/v1/status",
	)
	require.NoError(t, err)
	defer func() { _ = response.Body.Close() }()
	require.Equal(t, http.StatusForbidden, response.StatusCode)
	select {
	case <-upstreamCalled:
		t.Fatal("unauthorized HTTP request reached Emulator upstream")
	default:
	}

	auth := jwtx.New(nil)
	tokenInfo, err := auth.GenerateToken(context.Background(), &jwtx.UserInfo{Name: "operator@example.com"})
	require.NoError(t, err)
	websocketURL := "ws" + strings.TrimPrefix(proxyServer.URL, "http") +
		"/api/sico/sandbox/resources/emulator/resource/ws/h264"
	connection, websocketResponse, err := websocket.DefaultDialer.Dial(
		websocketURL,
		http.Header{"Origin": []string{proxyServer.URL}},
	)
	if websocketResponse != nil {
		defer func() { _ = websocketResponse.Body.Close() }()
	}
	require.NoError(t, err)
	defer func() { _ = connection.Close() }()
	require.NoError(t, connection.WriteJSON(websocketAuthMessage{
		Type: "auth", Token: tokenInfo.GetAccessToken(),
	}))
	_, _, err = connection.ReadMessage()
	var closeError *websocket.CloseError
	require.ErrorAs(t, err, &closeError)
	require.Equal(t, 4403, closeError.Code)
	select {
	case <-upstreamCalled:
		t.Fatal("unauthorized WebSocket reached Emulator upstream")
	default:
	}
}

func TestAuthorizeEmulatorResourceReportsInfrastructureFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(response)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/", nil)

	allowed := authorizeEmulatorResource(
		ctx,
		emulatorRouteAuthorizer{resourceErr: errors.New("RBAC unavailable")},
		&sandboximpl.Resource{},
	)
	require.False(t, allowed)
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
}

func TestEmulatorProviderListResourcesReturnsErrorWhenAllEndpointsFail(t *testing.T) {
	t.Parallel()
	p := &EmulatorProvider{
		BaseURLs: []string{"http://127.0.0.1:1"},
		http:     newHTTPClient(200 * time.Millisecond),
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	resources, err := p.ListResources(ctx)
	require.Error(t, err)
	require.Nil(t, resources)
}

func TestEmulatorProviderListResourcesSucceedsWhenAnyEndpointSucceeds(t *testing.T) {
	serviceToken := strings.Repeat("a", 64)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "Bearer "+serviceToken, request.Header.Get("Authorization"))
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(
			`{"devices":[{"device_index":3,"adb_host":"127.0.0.1",` +
				`"adb_port":16480}]}`,
		))
	}))
	defer server.Close()
	p := &EmulatorProvider{
		BaseURLs: []string{"http://127.0.0.1:1", server.URL},
		http:     newAuthenticatedHTTPClient(time.Second, serviceToken),
	}

	resources, err := p.ListResources(context.Background())
	require.NoError(t, err)
	require.Len(t, resources, 1)
	require.Equal(t, server.URL+"|3", resources[0].ResourceID)
	require.Equal(t, "16480", resources[0].Metadata["adbPort"])
	require.Equal(t, server.URL, resources[0].Metadata["providerBaseUrl"])
}

func TestNewEmulatorProviderRejectsInvalidToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "missing"},
		{name: "wrong length", token: strings.Repeat("a", 63)},
		{name: "uppercase", token: strings.Repeat("A", 64)},
		{name: "non hexadecimal", token: strings.Repeat("g", 64)},
		{name: "leading whitespace", token: " " + strings.Repeat("a", 64)},
		{name: "trailing whitespace", token: strings.Repeat("a", 64) + "\n"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv(sandboxServiceTokenEnv, test.token)
			require.PanicsWithValue(t, sandboxServiceTokenError, func() { NewEmulatorProvider() })
		})
	}
}
