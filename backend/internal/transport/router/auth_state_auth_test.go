package router

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/transport/http/middleware"
)

func TestAuthStateRouteAuthenticationBoundary(t *testing.T) {
	t.Parallel()

	router := gin.New()
	registerPublicAuthStateRoutes(router)
	router.Use(middleware.AuthMiddleware())
	registerAuthStateRoutes(router.Group("/api/sico"))

	request := httptest.NewRequest(http.MethodPost, "/api/sico/auth-state/import", bytes.NewBufferString("{}"))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code, "public import was blocked by authentication")

	for _, route := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/sico/auth-state"},
		{method: http.MethodPost, path: "/api/sico/auth-state/status"},
	} {
		request = httptest.NewRequest(route.method, route.path, nil)
		response = httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(
			t,
			http.StatusUnauthorized,
			response.Code,
			"%s %s bypassed authentication",
			route.method,
			route.path,
		)
	}
}

func TestAzureDevOpsRouteAuthenticationBoundary(t *testing.T) {
	t.Parallel()

	router := gin.New()
	registerPublicIntegrationRoutes(router)
	router.Use(middleware.AuthMiddleware())
	registerIntegrationRoutes(router.Group("/api/sico"))

	for _, path := range []string{
		"/api/sico/integrations/azure-devops/personal/callback",
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code, "%s was blocked by authentication", path)
		require.Contains(t, response.Body.String(), "state is required")
	}

	for _, route := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/sico/integrations/azure-devops/personal/start"},
		{method: http.MethodGet, path: "/api/sico/integrations/azure-devops/connections"},
		{method: http.MethodGet, path: "/api/sico/integrations/azure-devops/candidates"},
		{method: http.MethodGet, path: "/api/sico/integrations/azure-devops/project-connections"},
		{method: http.MethodPost, path: "/api/sico/integrations/azure-devops/content/query"},
		{method: http.MethodPost, path: "/api/sico/integrations/connections"},
	} {
		request := httptest.NewRequest(route.method, route.path, bytes.NewBufferString("{}"))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(
			t,
			http.StatusUnauthorized,
			response.Code,
			"%s %s bypassed authentication",
			route.method,
			route.path,
		)
	}
}

func TestAzureDevOpsRoutesArePersonalOnly(t *testing.T) {
	t.Parallel()
	router := gin.New()
	registerPublicIntegrationRoutes(router)
	registerIntegrationRoutes(router.Group("/api/sico"))
	for _, route := range router.Routes() {
		require.NotContains(t, route.Path, "/azure-devops/organization/")
		require.NotEqual(t, "/api/sico/integrations/azure-devops/personal/:connectionKey/projects", route.Path)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/sico/integrations/azure-devops/personal/key/projects", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusNotFound, response.Code)
}

func TestBearerAuthorizationCORSPreflight(t *testing.T) {
	t.Parallel()

	router := gin.New()
	router.Use(cors.New(defaultCORSConfig()))
	router.GET("/api/sico/health", Health)
	request := httptest.NewRequest(http.MethodOptions, "/api/sico/health", nil)
	request.Header.Set("Origin", "http://127.0.0.1:4173")
	request.Header.Set("Access-Control-Request-Method", http.MethodGet)
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusNoContent, response.Code)
	require.Contains(t, strings.ToLower(response.Header().Get("Access-Control-Allow-Headers")), "authorization")

	request = httptest.NewRequest(http.MethodGet, "/api/sico/health", nil)
	request.Header.Set("Origin", "http://127.0.0.1:4173")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	require.NotContains(t, strings.ToLower(response.Header().Get("Access-Control-Expose-Headers")), "authorization")
}
