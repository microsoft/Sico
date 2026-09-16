package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"sico-backend/internal/shared/tenantctx"
)

func TestSelectedOrganizationMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(SelectedOrganizationMiddleware())
	router.GET("/", func(ctx *gin.Context) {
		organizationID, ok := tenantctx.SelectedOrganization(ctx.Request.Context())
		require.True(t, ok)
		require.Equal(t, int64(42), organizationID)
		ctx.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(tenantctx.OrganizationHeader, "42")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusNoContent, response.Code)
}

func TestSelectedOrganizationMiddlewareRejectsInvalidHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(SelectedOrganizationMiddleware())
	router.GET("/", func(ctx *gin.Context) { ctx.Status(http.StatusNoContent) })

	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.Header.Set(tenantctx.OrganizationHeader, "invalid")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusBadRequest, response.Code)
}
