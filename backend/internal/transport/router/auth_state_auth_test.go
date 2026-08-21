package router

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

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
