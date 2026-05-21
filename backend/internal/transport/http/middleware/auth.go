// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package middleware

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"sico-backend/internal/consts"
	"sico-backend/internal/infra/cache"
	cachememory "sico-backend/internal/infra/cache/memory"
	cacheredis "sico-backend/internal/infra/cache/redis"
	"sico-backend/pkg/jwtx"
	"sico-backend/pkg/logger"
)

// UserInfo alias for jwtx.UserInfo
type UserInfo = jwtx.UserInfo

type ContextUserKeyType string

// ExcludePathConf Method empty means all
type ExcludePathConf struct {
	Path   string
	Method string
}

const (
	// ContextUserKey is the strongly typed key used to store user info in context.
	ContextUserKey ContextUserKeyType = "user"
	// BearerScheme is the authorization scheme
	BearerScheme = "Bearer "
)

// AuthConfig holds the configuration for authentication middleware
type AuthConfig struct {
	// ExcludedPaths are paths that don't require authentication
	ExcludedPaths []ExcludePathConf
	// ExcludedPrefixes are path prefixes that don't require authentication
	ExcludedPrefixes []string
	// JWTAuth is the JWT authentication handler
	JWTAuth jwtx.Auther
}

var (
	defaultConfig *AuthConfig
	configOnce    sync.Once
)

// getDefaultConfig lazily initializes and returns the default auth configuration.
// If REDIS_HOST is set, JWT token store uses Redis (required for multi-replica
// deployments so that logout invalidation is shared). Otherwise falls back to
// an in-process memory cache (suitable for single-instance / development).
func getDefaultConfig() *AuthConfig {
	configOnce.Do(func() {
		defaultConfig = &AuthConfig{
			ExcludedPaths: []ExcludePathConf{
				{Path: "/api/sico/rbac/login"},
				{Path: "/api/sico/rbac/user", Method: http.MethodPost},
				{Path: "/api/sico/health"},
				{Path: "/api/sico/llm/runtime/generate", Method: http.MethodPost},
				{Path: "/api/sico/llm/runtime/generate/stream", Method: http.MethodPost},
				{Path: "/api/sico/project/asset", Method: http.MethodPost},
				{Path: "/api/sico/project/sas_asset", Method: http.MethodGet},
				{Path: "/api/sico/project/asset", Method: http.MethodDelete},
			},
			ExcludedPrefixes: []string{
				"/api/sico/docs/",
				"/api/sico/sandbox",
			},
			JWTAuth: jwtx.New(jwtx.NewStoreWithCache(newCacheFromEnv())),
		}
	})
	return defaultConfig
}

// newCacheFromEnv returns a Redis-backed cache when REDIS_HOST is configured,
// otherwise an in-process memory cache.
func newCacheFromEnv() cache.Cache {
	host := os.Getenv(consts.RedisHost)
	port := os.Getenv(consts.RedisPort)
	password := os.Getenv(consts.RedisPassword)

	addr := host + ":" + port
	rc, err := cacheredis.Dial(addr, redis.Options{
		DB: 0, // Default database

		// Authentication
		Username: "", // No username for default Redis setup
		Password: password,

		// Connection pool settings
		PoolSize:        100,             // Max connections (recommended: CPU cores * 10)
		MinIdleConns:    10,              // Min idle connections
		MaxIdleConns:    30,              // Max idle connections
		ConnMaxIdleTime: 5 * time.Minute, // Idle connection timeout

		// Timeouts
		DialTimeout:  5 * time.Second, // Connection establishment timeout
		ReadTimeout:  3 * time.Second, // Read operation timeout
		WriteTimeout: 3 * time.Second, // Write operation timeout
	})
	if err != nil {
		logger.Warn("Redis not reachable at %s, falling back to in-memory cache: %v", addr, err)
		return cachememory.New()
	}

	logger.Info("JWT store using Redis at %s", addr)
	return rc
}

// InitAuthConfig allows overriding the default auth configuration
// This should be called before any middleware is used if custom configuration is needed
func InitAuthConfig(config *AuthConfig) {
	if config != nil {
		defaultConfig = config
	}
}

// AuthMiddleware returns a Gin middleware for authentication
func AuthMiddleware(excludedPaths ...ExcludePathConf) gin.HandlerFunc {
	config := getDefaultConfig()

	// Create a copy of the config if additional excluded paths are provided
	if len(excludedPaths) > 0 {
		// Create a new config based on default to avoid modifying the global config
		newConfig := &AuthConfig{
			ExcludedPaths:    make([]ExcludePathConf, len(config.ExcludedPaths)),
			ExcludedPrefixes: make([]string, len(config.ExcludedPrefixes)),
			JWTAuth:          config.JWTAuth,
		}
		copy(newConfig.ExcludedPaths, config.ExcludedPaths)
		copy(newConfig.ExcludedPrefixes, config.ExcludedPrefixes)
		newConfig.ExcludedPaths = append(newConfig.ExcludedPaths, excludedPaths...)
		config = newConfig
	}

	return func(c *gin.Context) {
		if shouldExcludePath(c, config) {
			c.Next()
			return
		}

		// Extract token from Authorization header
		token := extractToken(c.Request)
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header missing or invalid"})
			c.Abort()
			return
		}

		// Parse and validate the token
		userInfo, err := config.JWTAuth.ParseSubject(c.Request.Context(), token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("Invalid or expired token, detail:%v", err)})
			c.Abort()
			return
		}

		// Store user info in context
		c.Set(ContextUserKey, *userInfo) // Store in Gin context for handlers
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), ContextUserKey, *userInfo))
		c.Next()
	}
}

// shouldExcludePath checks if a path should be excluded from authentication
func shouldExcludePath(c *gin.Context, config *AuthConfig) bool {
	path := c.Request.URL.Path
	method := c.Request.Method

	// Check exact path matches
	for _, excludedConf := range config.ExcludedPaths {
		if path == excludedConf.Path {
			if len(excludedConf.Method) == 0 || method == excludedConf.Method {
				return true
			}
		}

		// Handle wildcard paths (e.g., /api/docs/*)
		if strings.HasSuffix(excludedConf.Path, "*") {
			prefix := strings.TrimSuffix(excludedConf.Path, "*")
			if strings.HasPrefix(path, prefix) {
				if len(excludedConf.Method) == 0 || method == excludedConf.Method {
					return true
				}
			}
		}
	}

	// Check path prefixes
	for _, prefix := range config.ExcludedPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return false
}

// IsAuthExcluded exposes the auth exclusion (whitelist) logic for other middlewares (e.g. Casbin)
// It uses the defaultConfig. Dynamic per-request overrides passed via AuthMiddleware(excludedPaths ...)
// are not considered here to keep logic simple; if needed we can extend with a registry later.
func IsAuthExcluded(c *gin.Context) bool {
	return shouldExcludePath(c, defaultConfig)
}

// extractToken extracts the JWT token from the Authorization header
func extractToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return ""
	}

	// Check if it starts with "Bearer "
	if strings.HasPrefix(authHeader, BearerScheme) {
		return strings.TrimPrefix(authHeader, BearerScheme)
	}

	return authHeader
}

// GetUserFromContext retrieves the user information from the context.
// The key is the typed ContextUserKey set by AuthMiddleware on the request
// context, which works for both *gin.Context and any derived context.Context
// (e.g. c.Request.Context() or a background context seeded in tests/seeders).
func GetUserFromContext(ctx context.Context) (UserInfo, bool) {
	if value := ctx.Value(ContextUserKey); value != nil {
		if user, ok := value.(UserInfo); ok {
			return user, true
		}
	}

	return UserInfo{Name: "SYSTEM"}, false
}

func MustGetUsernameFromCtx(ctx context.Context) string {
	userInfo, success := GetUserFromContext(ctx)
	if !success {
		panic("mustGetUsernameFromCtx: userInfo is nil")
	}

	return userInfo.Name
}

func GetUsernameFromCtx(ctx context.Context) *string {
	userInfo, success := GetUserFromContext(ctx)
	if !success {
		return nil
	}

	return &userInfo.Name
}

// RequireRoles returns a middleware that checks if the user has any of the required roles
func RequireRoles(roles ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, exists := GetUserFromContext(c)
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
			c.Abort()
			return
		}

		// Check if user has any of the required roles
		for _, requiredRole := range roles {
			for _, userRole := range user.Roles {
				if userRole == requiredRole {
					c.Next()
					return
				}
			}
		}

		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions"})
		c.Abort()
	}
}

// RequireGroups returns a middleware that checks if the user belongs to any of the required groups
func RequireGroups(groups ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, exists := GetUserFromContext(c)
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
			c.Abort()
			return
		}

		// Check if user belongs to any of the required groups
		for _, requiredGroup := range groups {
			for _, userGroup := range user.Groups {
				if userGroup == requiredGroup {
					c.Next()
					return
				}
			}
		}

		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions"})
		c.Abort()
	}
}
