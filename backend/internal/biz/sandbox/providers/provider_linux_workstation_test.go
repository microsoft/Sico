package providers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/shared/enum"
)

type linuxWorkstationTestPool struct {
	resource *sandboximpl.Resource
}

func (p *linuxWorkstationTestPool) ResolveResourceByHash(
	context.Context,
	string,
	string,
) (*sandboximpl.Resource, error) {
	return p.resource, nil
}

func (*linuxWorkstationTestPool) UpdateResolvedResourceCache(context.Context, *sandboximpl.Resource) error {
	return nil
}

func TestLinuxWorkstationEndpointRendering(t *testing.T) {
	provider := &LinuxWorkstationProvider{}
	endpoints := provider.RenderEndpoints("http://linux-workstation", nil)

	require.Contains(t, endpoints.Endpoint, "/api/sico/sandbox/resources/linux_workstation/")
	require.Equal(t, "http://linux-workstation/v1/openapi.json", provider.OpenAPIURL(
		"", map[string]string{"directEndpoint": "http://linux-workstation"},
	))
}

func TestLinuxWorkstationResourceRouteProxiesAndRewritesHTML(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		require.Equal(t, "/index.html", request.URL.Path)
		response.Header().Set("Content-Type", "text/html")
		_, _ = response.Write([]byte(`<a href="/v1/docs">docs</a>`))
	}))
	t.Cleanup(upstream.Close)

	pool := &linuxWorkstationTestPool{resource: &sandboximpl.Resource{
		Type: enum.SandboxTypeLinuxWorkstation.String(), ResourceID: upstream.URL,
	}}
	integration := (publicFactory{}).NewIntegration([]sandboximpl.Provider{&LinuxWorkstationProvider{}}, nil, nil)
	integration.(*publicIntegration).pool = pool
	engine := gin.New()
	integration.RegisterHTTPRoutes(engine.Group("/api/sico"))
	proxyServer := httptest.NewServer(engine)
	t.Cleanup(proxyServer.Close)

	response, err := http.Get(proxyServer.URL + "/api/sico/sandbox/resources/linux_workstation/resource/")
	require.NoError(t, err)
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)

	require.Equal(t, http.StatusOK, response.StatusCode)
	require.True(t, strings.Contains(string(body), `/api/sico/sandbox/resources/linux_workstation/resource/v1/docs`))
}
