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
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	jsoniter "github.com/json-iterator/go"
	"github.com/redis/go-redis/v9"

	"sico-backend/internal/consts"
	cacheredis "sico-backend/internal/infra/cache/redis"
	"sico-backend/pkg/env"
	"sico-backend/pkg/logger"
)

const (
	// Header keys for sandbox client authentication
	HeaderClientID    = "X-Sico-Client-Id"
	HeaderTimestamp   = "X-Sico-Timestamp"
	HeaderNonce       = "X-Sico-Nonce"
	HeaderSignature   = "X-Sico-Signature"
	HeaderSicoContext = "X-Sico-Context"

	// Context keys
	ContextSandboxClientID     = "sandbox_client_id"
	ContextSandboxClientSecret = "sandbox_client_secret"
	ContextSandboxInstanceID   = "sandbox_instance_id"
)

var (
	// Signature validation settings
	MaxTimestampDrift = getDurationSeconds(consts.SandboxMaxTimestampDrift, 300)
	NonceExpiry       = getDurationSeconds(consts.SandboxNonceExpiry, 600)
)

// getSandboxAuthConfig returns the configuration for sandbox authentication.
// RedisClient must be injected via SetRedisClient before middleware is used.
func getSandboxAuthConfig() *SandboxAuthConfig {
	return &SandboxAuthConfig{
		RedisClient: cacheredis.GetRedisFromEnvironment(),
		GetClientSecret: func(clientID string) (string, error) {
			secret := getClientSecretFromEnv(clientID)
			if secret == "" {
				return "", fmt.Errorf("sandbox client %q not configured", clientID)
			}

			return secret, nil
		},
	}
}

// SandboxAuthConfig holds configuration for sandbox authentication
type SandboxAuthConfig struct {
	RedisClient *redis.Client
	// GetClientSecret returns the secret for a given client ID
	// In production, this should query a secure store (database, vault, etc.)
	GetClientSecret func(clientID string) (string, error)
}

// SandboxAuthMiddleware creates a middleware for sandbox client authentication
// It validates the request signature using HMAC-SHA256
func SandboxAuthMiddleware() gin.HandlerFunc {
	config := getSandboxAuthConfig()
	if config == nil || config.RedisClient == nil {
		logger.Error("SandboxAuthMiddleware: redis client is not configured")
		return func(c *gin.Context) {
			abortWithError(c, http.StatusServiceUnavailable, "Sandbox authentication is not configured")
		}
	}

	return func(c *gin.Context) {
		headers, ok := extractSandboxAuthHeaders(c)
		if !ok {
			return
		}

		if !validateSandboxTimestamp(c, headers.timestamp) {
			return
		}

		if !checkAndStoreNonce(c, config, headers.clientID, headers.nonce) {
			return
		}

		secret, ok := lookupSandboxClientSecret(c, config, headers.clientID)
		if !ok {
			return
		}

		if !verifySandboxSignature(c, headers, secret) {
			return
		}

		instanceID := extractInstanceIDFromSicoContextHeader(headers.contextHeader)
		if instanceID == "" {
			abortWithError(c, http.StatusBadRequest, "Invalid X-Sico-Context header")
			return
		}

		// Authentication successful - store client + instance info in context
		c.Set(ContextSandboxClientID, headers.clientID)
		c.Set(ContextSandboxClientSecret, secret)
		c.Set(ContextSandboxInstanceID, instanceID)

		logger.Info("Sandbox client authenticated: %s, path: %s", headers.clientID, c.Request.URL.Path)

		c.Next()
	}
}

// sandboxAuthHeaders bundles the request headers consumed by sandbox auth.
type sandboxAuthHeaders struct {
	clientID      string
	timestamp     string
	nonce         string
	signature     string
	contextHeader string
}

// extractSandboxAuthHeaders reads and validates presence of required headers.
// On failure it aborts c with an appropriate status and returns ok=false.
func extractSandboxAuthHeaders(c *gin.Context) (sandboxAuthHeaders, bool) {
	h := sandboxAuthHeaders{
		clientID:      c.GetHeader(HeaderClientID),
		timestamp:     c.GetHeader(HeaderTimestamp),
		nonce:         c.GetHeader(HeaderNonce),
		signature:     c.GetHeader(HeaderSignature),
		contextHeader: c.GetHeader(HeaderSicoContext),
	}

	if h.clientID == "" || h.timestamp == "" || h.nonce == "" || h.signature == "" {
		abortWithError(c, http.StatusUnauthorized, "Missing authentication headers")
		return h, false
	}
	if strings.TrimSpace(h.contextHeader) == "" {
		abortWithError(c, http.StatusBadRequest, "Missing X-Sico-Context header")
		return h, false
	}

	return h, true
}

// validateSandboxTimestamp parses the timestamp header and ensures drift is in range.
func validateSandboxTimestamp(c *gin.Context, timestamp string) bool {
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		abortWithError(c, http.StatusUnauthorized, "Invalid timestamp format")
		return false
	}

	now := time.Now().Unix()
	drift := time.Duration(abs(now-ts)) * time.Second
	if drift > MaxTimestampDrift {
		abortWithError(c, http.StatusUnauthorized, fmt.Sprintf("Timestamp drift too large: %v", drift))
		return false
	}

	return true
}

// checkAndStoreNonce rejects replayed nonces and records the nonce for future requests.
func checkAndStoreNonce(c *gin.Context, config *SandboxAuthConfig, clientID, nonce string) bool {
	nonceKey := fmt.Sprintf("sandbox:nonce:%s:%s", clientID, nonce)
	exists, err := config.RedisClient.Exists(c.Request.Context(), nonceKey).Result()
	if err != nil {
		logger.Error("Failed to check nonce existence: %v", err)
		abortWithError(c, http.StatusInternalServerError, "Internal server error")
		return false
	}

	if exists > 0 {
		abortWithError(c, http.StatusUnauthorized, "Nonce already used (replay attack detected)")
		return false
	}

	if err := config.RedisClient.Set(c.Request.Context(), nonceKey, "1", NonceExpiry).Err(); err != nil {
		logger.Error("Failed to store nonce: %v", err)
		// Continue anyway - security vs availability tradeoff
	}

	return true
}

// lookupSandboxClientSecret resolves the configured secret for a client ID.
func lookupSandboxClientSecret(c *gin.Context, config *SandboxAuthConfig, clientID string) (string, bool) {
	if config.GetClientSecret == nil {
		return "", true
	}

	secret, err := config.GetClientSecret(clientID)
	if err != nil {
		logger.Warn("SandboxAuthMiddleware: %v", err)
		abortWithError(c, http.StatusUnauthorized, "Client not configured")
		return "", false
	}

	return secret, true
}

// verifySandboxSignature recomputes the expected HMAC and compares it to the header.
func verifySandboxSignature(c *gin.Context, h sandboxAuthHeaders, secret string) bool {
	payload := fmt.Sprintf("%s|%s|%s", h.clientID, h.timestamp, h.nonce)
	expectedSignature := calculateHMAC(payload, secret)

	if !hmac.Equal([]byte(h.signature), []byte(expectedSignature)) {
		logger.Warn("Signature mismatch for client %s. Expected: %s, Got: %s, Payload: %s",
			h.clientID, expectedSignature, h.signature, payload)
		abortWithError(c, http.StatusUnauthorized, "Invalid signature")
		return false
	}

	return true
}

func getDurationSeconds(key string, defaultSeconds int) time.Duration {
	val := env.GetOrDefault(key, strconv.Itoa(defaultSeconds))
	seconds, err := strconv.Atoi(strings.TrimSpace(val))
	if err != nil || seconds <= 0 {
		return time.Duration(defaultSeconds) * time.Second
	}

	return time.Duration(seconds) * time.Second
}

// GetSandboxClientFromContext retrieves the authenticated client ID from context
func GetSandboxClientFromContext(c *gin.Context) (string, bool) {
	clientID, exists := c.Get(ContextSandboxClientID)
	if !exists {
		return "", false
	}

	if id, ok := clientID.(string); ok {
		return id, true
	}

	return "", false
}

// GetSandboxInstanceIDFromContext retrieves the parsed instance ID (if any) from context.
// It is extracted from the `X-Sico-Context` header by SandboxAuthMiddleware.
func GetSandboxInstanceIDFromContext(c *gin.Context) (string, bool) {
	instanceID, exists := c.Get(ContextSandboxInstanceID)
	if !exists {
		return "", false
	}
	if id, ok := instanceID.(string); ok {
		return id, true
	}

	return "", false
}

func extractInstanceIDFromSicoContextHeader(contextHeader string) string {
	var ctx struct {
		AgentInstanceID int64  `json:"agentInstanceId"`
		InstanceID      string `json:"instanceId"`
	}
	if err := jsoniter.UnmarshalFromString(contextHeader, &ctx); err != nil {
		return ""
	}

	if ctx.AgentInstanceID > 0 {
		return strconv.FormatInt(ctx.AgentInstanceID, 10)
	}
	if ctx.InstanceID != "" {
		return ctx.InstanceID
	}

	return ""
}

// calculateHMAC computes HMAC-SHA256 signature
func calculateHMAC(message, secret string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(message))

	return hex.EncodeToString(h.Sum(nil))
}

// getClientSecretFromEnv gets client secret from environment.
// Format: SANDBOX_CLIENT_SECRET_<CLIENT_ID>=<secret>
// Example: SANDBOX_CLIENT_SECRET_TEST_CLIENT=change-me
func getClientSecretFromEnv(clientID string) string {
	sanitized := strings.ToUpper(strings.ReplaceAll(clientID, "-", "_"))
	key := fmt.Sprintf("%s%s", consts.SandboxClientSecretPrefix, sanitized)
	return strings.TrimSpace(os.Getenv(key))
}

func abortWithError(c *gin.Context, code int, message string) {
	c.AbortWithStatusJSON(code, gin.H{
		"code": code,
		"msg":  message,
		"data": nil,
	})
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}

	return n
}
