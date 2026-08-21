package middleware

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/casbin/casbin/v2"
	"github.com/gin-gonic/gin"

	"sico-backend/internal/errcode"
	"sico-backend/pkg/logger"
)

// CasbinMiddleware enforces permission using provided enforcer.
// Subject is the username from context (set by auth middleware).
// Object is the route path root segment (/rbac/role -> rbac:role).
// Action is HTTP method (GET/POST/PUT/DELETE).
func CasbinMiddleware(enforcer *casbin.Enforcer) gin.HandlerFunc {
	return func(c *gin.Context) {
		if enforcer == nil {
			c.Next()
			return
		}

		// Skip if path is in auth whitelist to avoid duplicate checks
		if IsAuthExcluded(c) {
			c.Next()
			return
		}

		user, ok := GetUserFromContext(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{
				"code": errcode.CommonUnauthorized,
				"msg":  "Authentication required",
			})
			c.Abort()
			return
		}

		// build object key
		obj := normalizeObject(c.FullPath())
		act := c.Request.Method
		// Allow if there is no policy defined for this (obj, act)
		// In domain model, policy columns are: v0=role, v1=domain, v2=obj, v3=act
		candidate, _ := enforcer.GetFilteredPolicy(2, obj, act)
		if len(candidate) == 0 {
			c.Next()
			return
		}

		// Route-level coarse check uses "*" as domain — only verifies
		// the user holds some role that grants access to this resource/action.
		// Entity-scoped checks happen in the biz layer with the actual domain.
		allowed, err := enforcer.Enforce(user.Name, "*", obj, act)
		if err != nil {
			logger.Warn("casbin enforce error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"code": errcode.CommonInternalError,
				"msg":  "internal server error",
			})
			c.Abort()
			return
		}
		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{"code": errcode.CommonForbidden, "msg": "forbidden"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// normalizeObject converts an API path into a normalized casbin object string:
// 1. Joins segments with ':' e.g. rbac/role -> rbac:role
// 2. Replaces numeric or UUID-like segments with wildcard '*'
var uuidLike = regexp.MustCompile(`(?i)^[0-9a-f-]{8,}$`)
var numLike = regexp.MustCompile(`^[0-9]+$`)

func normalizeObject(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}

	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, p := range parts {
		if numLike.MatchString(p) || uuidLike.MatchString(p) {
			parts[i] = "*"
		}
	}

	return "/" + strings.Join(parts, "/")
}
