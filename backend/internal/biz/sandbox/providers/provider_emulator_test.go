package providers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/shared/enum"
)

type emulatorRoutePool struct {
	resource *sandboximpl.Resource
}

func (p *emulatorRoutePool) ResolveResourceByHash(
	context.Context,
	string,
	string,
) (*sandboximpl.Resource, error) {
	return p.resource, nil
}

func (*emulatorRoutePool) UpdateResolvedResourceCache(context.Context, *sandboximpl.Resource) error {
	return nil
}

func TestPublicFactoryIncludesEmulatorProvider(t *testing.T) {
	providers := (publicFactory{}).Providers()
	require.Len(t, providers, 1)
	require.Equal(t, enum.SandboxTypeEmulator.String(), providers[0].Type())
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
	require.NotContains(t, response.Body.String(), "Copyright (c)")
	require.NotContains(t, response.Body.String(), "__WS_PATH__")
}

func TestEmulatorProviderResourceAPIProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "/api/v1/status", request.URL.Path)
		require.Equal(t, "value", request.URL.Query().Get("key"))
		require.Empty(t, request.Header.Get("X-Sico-Token"))
		_, _ = response.Write([]byte("proxied"))
	}))
	defer upstream.Close()

	provider := &EmulatorProvider{}
	integration := &publicIntegration{
		providers: []sandboximpl.Provider{provider},
		pool: &emulatorRoutePool{resource: &sandboximpl.Resource{
			Type: provider.Type(), ResourceID: upstream.URL + "|3",
		}},
	}
	engine := gin.New()
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	defer proxyServer.Close()
	request, err := http.NewRequest(
		http.MethodGet,
		proxyServer.URL+"/api/sico/sandbox/resources/emulator/resource/api/v1/status?key=value",
		nil,
	)
	require.NoError(t, err)
	request.Header.Set("X-Sico-Token", "secret")
	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, "proxied", string(body))
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
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(
			`{"devices":[{"device_index":3,"adb_host":"127.0.0.1",` +
				`"adb_port":16480,"view_url":"/vnc/view/3"}]}`,
		))
	}))
	defer server.Close()
	p := &EmulatorProvider{
		BaseURLs: []string{"http://127.0.0.1:1", server.URL},
		http:     newHTTPClient(time.Second),
	}

	resources, err := p.ListResources(context.Background())
	require.NoError(t, err)
	require.Len(t, resources, 1)
	require.Equal(t, server.URL+"|3", resources[0].ResourceID)
	require.Equal(t, "16480", resources[0].Metadata["adbPort"])
	require.Equal(t, server.URL, resources[0].Metadata["providerBaseUrl"])
}
