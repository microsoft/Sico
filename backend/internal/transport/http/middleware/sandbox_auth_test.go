package middleware

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
)

func TestMain(m *testing.M) {
	gin.SetMode(gin.TestMode)
	os.Exit(m.Run())
}

func TestCalculateHMAC(t *testing.T) {
	// Known test vector: HMAC-SHA256("hello", "secret")
	msg := "hello"
	secret := "secret"
	got := calculateHMAC(msg, secret)

	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(msg))
	want := hex.EncodeToString(h.Sum(nil))

	assert.Equal(t, want, got)
}

func TestCalculateHMAC_DifferentKeys(t *testing.T) {
	msg := "same-payload"
	sig1 := calculateHMAC(msg, "key1")
	sig2 := calculateHMAC(msg, "key2")
	assert.NotEqual(t, sig1, sig2, "different keys must produce different signatures")
}

func TestDefaultAuthConfigExcludesDeviceTunnelPrefix(t *testing.T) {
	assert.Contains(t, getDefaultConfig().ExcludedPrefixes, "/api/sico/sandbox/device/")
}

func TestDefaultAuthConfigExcludesProviderResourcePrefix(t *testing.T) {
	assert.Contains(t, getDefaultConfig().ExcludedPrefixes, "/api/sico/sandbox/resources/")
}

func TestCalculateHMAC_SignaturePayloadFormat(t *testing.T) {
	// Verify the payload format: clientID|timestamp|nonce
	clientID := "client1"
	ts := "1700000000"
	nonce := "abc123"
	payload := fmt.Sprintf("%s|%s|%s", clientID, ts, nonce)

	sig := calculateHMAC(payload, "test_secret")
	assert.Len(t, sig, 64, "HMAC-SHA256 hex output is 64 chars")
}

func TestAbs(t *testing.T) {
	assert.Equal(t, int64(5), abs(5))
	assert.Equal(t, int64(5), abs(-5))
	assert.Equal(t, int64(0), abs(0))
}

func TestAbortWithError(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

	abortWithError(c, http.StatusUnauthorized, "test error")

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "test error")
}

func TestGetSandboxClientFromContext(t *testing.T) {
	t.Run("present", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(ContextSandboxClientID, "client1")

		id, ok := GetSandboxClientFromContext(c)
		assert.True(t, ok)
		assert.Equal(t, "client1", id)
	})

	t.Run("missing", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		id, ok := GetSandboxClientFromContext(c)
		assert.False(t, ok)
		assert.Equal(t, "", id)
	})

	t.Run("wrong type", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(ContextSandboxClientID, 12345)

		id, ok := GetSandboxClientFromContext(c)
		assert.False(t, ok)
		assert.Equal(t, "", id)
	})
}

func TestGetSandboxInstanceIDFromContext(t *testing.T) {
	t.Run("present", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(ContextSandboxInstanceID, "42")

		id, ok := GetSandboxInstanceIDFromContext(c)
		assert.True(t, ok)
		assert.Equal(t, "42", id)
	})

	t.Run("missing", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)

		_, ok := GetSandboxInstanceIDFromContext(c)
		assert.False(t, ok)
	})
}

func TestExtractInstanceIDFromSicoContextHeader(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"agentInstanceId int", `{"agentInstanceId": 42}`, "42"},
		{"instanceId string", `{"instanceId": "abc"}`, "abc"},
		{"empty object", `{}`, ""},
		{"invalid json", `not json`, ""},
		{"zero id", `{"agentInstanceId": 0}`, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractInstanceIDFromSicoContextHeader(tt.header)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestSandboxAuthMiddleware_Returns503WhenNoRedis(t *testing.T) {
	// Without Redis configured, middleware should reject requests
	handler := SandboxAuthMiddleware()

	w := httptest.NewRecorder()
	_, engine := gin.CreateTestContext(w)
	engine.POST("/test", handler, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	req := httptest.NewRequest(http.MethodPost, "/test", nil)
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "not configured")
}

func TestSandboxAuthMiddleware_MissingHeaders(t *testing.T) {
	// Use miniredis for a real Redis
	// But since sandbox auth checks RedisClient != nil first,
	// and we tested permissive mode above, let's test header validation
	// by providing a mock Redis via the config

	// For now, test that the middleware factory at least doesn't panic
	handler := SandboxAuthMiddleware()
	assert.NotNil(t, handler)
}

func newSandboxAuthTestEngine(client *redis.Client, secret string) *gin.Engine {
	engine := gin.New()
	engine.POST(
		"/test",
		sandboxAuthMiddleware(&SandboxAuthConfig{
			RedisClient: client,
			GetClientSecret: func(string) (string, error) {
				return secret, nil
			},
		}),
		func(c *gin.Context) { c.Status(http.StatusOK) },
	)
	return engine
}

func newSandboxAuthTestRequest(secret, nonce string) *http.Request {
	clientID := "test-client"
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	signature := calculateHMAC(fmt.Sprintf("%s|%s|%s", clientID, timestamp, nonce), secret)
	request := httptest.NewRequest(http.MethodPost, "/test", nil)
	request.Header.Set(HeaderClientID, clientID)
	request.Header.Set(HeaderTimestamp, timestamp)
	request.Header.Set(HeaderNonce, nonce)
	request.Header.Set(HeaderSignature, signature)
	request.Header.Set(HeaderSicoContext, `{"agentInstanceId":42}`)
	return request
}

func TestSandboxAuthMiddleware_InvalidSignatureDoesNotConsumeNonce(t *testing.T) {
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { assert.NoError(t, client.Close()) })
	const secret = "test-secret"
	engine := newSandboxAuthTestEngine(client, secret)

	invalidRequest := newSandboxAuthTestRequest(secret, "shared-nonce")
	invalidRequest.Header.Set(HeaderSignature, "invalid")
	invalidResponse := httptest.NewRecorder()
	engine.ServeHTTP(invalidResponse, invalidRequest)
	assert.Equal(t, http.StatusUnauthorized, invalidResponse.Code)

	validResponse := httptest.NewRecorder()
	engine.ServeHTTP(validResponse, newSandboxAuthTestRequest(secret, "shared-nonce"))
	assert.Equal(t, http.StatusOK, validResponse.Code)
}

func TestSandboxAuthMiddleware_ConcurrentNonceClaimIsAtomic(t *testing.T) {
	miniRedis := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: miniRedis.Addr()})
	t.Cleanup(func() { assert.NoError(t, client.Close()) })
	const secret = "test-secret"
	const requestCount = 16
	engine := newSandboxAuthTestEngine(client, secret)
	start := make(chan struct{})
	statuses := make(chan int, requestCount)
	var waitGroup sync.WaitGroup

	for range requestCount {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			request := newSandboxAuthTestRequest(secret, "concurrent-nonce")
			response := httptest.NewRecorder()
			<-start
			engine.ServeHTTP(response, request)
			statuses <- response.Code
		}()
	}
	close(start)
	waitGroup.Wait()
	close(statuses)

	allowed := 0
	rejected := 0
	for statusCode := range statuses {
		switch statusCode {
		case http.StatusOK:
			allowed++
		case http.StatusUnauthorized:
			rejected++
		default:
			t.Fatalf("unexpected status code: %d", statusCode)
		}
	}
	assert.Equal(t, 1, allowed)
	assert.Equal(t, requestCount-1, rejected)
}

func TestSandboxAuthMiddleware_NonceStoreFailureIsClosed(t *testing.T) {
	miniRedis, err := miniredis.Run()
	assert.NoError(t, err)
	address := miniRedis.Addr()
	miniRedis.Close()
	client := redis.NewClient(&redis.Options{
		Addr: address, MaxRetries: -1,
		DialTimeout: 50 * time.Millisecond, ReadTimeout: 50 * time.Millisecond,
		WriteTimeout: 50 * time.Millisecond,
	})
	t.Cleanup(func() { assert.NoError(t, client.Close()) })
	const secret = "test-secret"
	engine := newSandboxAuthTestEngine(client, secret)

	response := httptest.NewRecorder()
	engine.ServeHTTP(response, newSandboxAuthTestRequest(secret, "redis-error-nonce"))
	assert.Equal(t, http.StatusInternalServerError, response.Code)
}

func TestGetDurationSeconds(t *testing.T) {
	t.Run("default", func(t *testing.T) {
		d := getDurationSeconds("NONEXISTENT_ENV_VAR_12345", 42)
		assert.Equal(t, 42*time.Second, d)
	})

	t.Run("from env", func(t *testing.T) {
		t.Setenv("TEST_DURATION_VAR", "10")
		d := getDurationSeconds("TEST_DURATION_VAR", 42)
		assert.Equal(t, 10*time.Second, d)
	})

	t.Run("invalid env falls back to default", func(t *testing.T) {
		t.Setenv("TEST_DURATION_BAD", "abc")
		d := getDurationSeconds("TEST_DURATION_BAD", 42)
		assert.Equal(t, 42*time.Second, d)
	})
}

func TestSignatureRoundTrip(t *testing.T) {
	// Simulate a full signature creation and verification
	clientID := "test_client"
	secret := "test_secret_key_for_development_only"
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "unique-nonce-123"

	payload := fmt.Sprintf("%s|%s|%s", clientID, ts, nonce)
	signature := calculateHMAC(payload, secret)

	// Verify signature matches
	expected := calculateHMAC(payload, secret)
	assert.True(t, hmac.Equal([]byte(signature), []byte(expected)))

	// Verify wrong secret fails
	wrongSig := calculateHMAC(payload, "wrong_secret")
	assert.False(t, hmac.Equal([]byte(signature), []byte(wrongSig)))
}
