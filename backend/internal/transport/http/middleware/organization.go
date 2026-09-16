package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"sico-backend/internal/shared/tenantctx"
)

func SelectedOrganizationMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawOrganizationID := strings.TrimSpace(c.GetHeader(tenantctx.OrganizationHeader))
		if rawOrganizationID == "" {
			c.Next()
			return
		}

		organizationID, err := strconv.ParseInt(rawOrganizationID, 10, 64)
		if err != nil || organizationID <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid X-Sico-Organization-ID header"})
			c.Abort()
			return
		}

		c.Request = c.Request.WithContext(tenantctx.WithSelectedOrganization(c.Request.Context(), organizationID))
		c.Next()
	}
}
