package redis

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore/policy"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/redis/go-redis/v9"

	"sico-backend/internal/consts"
	"sico-backend/internal/infra/cache"
)

// Compile-time check.
var _ cache.Cache = (*RedisCache)(nil)

// RedisCache implements cache.Cache backed by a Redis client.
type RedisCache struct {
	client *redis.Client
}

// New creates a RedisCache wrapping the provided redis.Client.
func New(client *redis.Client) *RedisCache {
	return &RedisCache{client: client}
}

// Dial creates a redis.Client, pings it, and returns a RedisCache.
// Returns an error if the connection cannot be established.
func Dial(addr string, opts ...redis.Options) (*RedisCache, error) {
	o := redis.Options{Addr: addr}
	if len(opts) > 0 {
		o = opts[0]
		if o.Addr == "" {
			o.Addr = addr
		}
	}
	client := redis.NewClient(&o)
	if err := client.Ping(context.Background()).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis ping %s: %w", addr, err)
	}
	return New(client), nil
}

func (c *RedisCache) Set(ctx context.Context, ns, key, value string, expiration ...time.Duration) error {
	var exp time.Duration
	if len(expiration) > 0 {
		exp = expiration[0]
	}
	return c.client.Set(ctx, nsKey(ns, key), value, exp).Err()
}

func (c *RedisCache) Get(ctx context.Context, ns, key string) (string, bool, error) {
	value, err := c.client.Get(ctx, nsKey(ns, key)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return "", false, nil
		}
		return "", false, err
	}
	return value, true, nil
}

func (c *RedisCache) Exists(ctx context.Context, ns, key string) (bool, error) {
	count, err := c.client.Exists(ctx, nsKey(ns, key)).Result()
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

func (c *RedisCache) Delete(ctx context.Context, ns, key string) error {
	return c.client.Del(ctx, nsKey(ns, key)).Err()
}

func (c *RedisCache) Close(_ context.Context) error {
	if c.client == nil {
		return nil
	}
	return c.client.Close()
}

func nsKey(ns, key string) string {
	return fmt.Sprintf("%s:%s", ns, key)
}

var redisFromEnvironment *redis.Client

func extractUsernameFromToken(token string) string {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return ""
	}
	payload := parts[1]
	switch len(payload) % 4 {
	case 2:
		payload += "=="
	case 3:
		payload += "="
	}
	decoded, err := base64.URLEncoding.DecodeString(payload)
	if err != nil {
		return ""
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return ""
	}
	username, _ := claims["oid"].(string)
	return username
}

func redisCredentialProvider(ctx context.Context) (username, password string, err error) {
	credential, err := azidentity.NewDefaultAzureCredential(nil)
	if err != nil {
		return "", "", err
	}
	token, err := credential.GetToken(ctx, policy.TokenRequestOptions{
		Scopes: []string{"https://redis.azure.com/.default"},
	})
	if err != nil {
		return "", "", err
	}
	username = extractUsernameFromToken(token.Token)
	if username == "" {
		return "", "", err
	}
	password = token.Token
	if password == "" {
		return "", "", err
	}
	return username, password, nil
}

func GetRedisFromEnvironment() *redis.Client {
	if redisFromEnvironment == nil {
		redisFromEnvironment = NewFromEnvironment()
	}
	return redisFromEnvironment
}

func NewFromEnvironment() *redis.Client {
	if redisFromEnvironment != nil {
		return redisFromEnvironment
	}
	host := os.Getenv(consts.RedisHost)
	port := os.Getenv(consts.RedisPort)
	password := os.Getenv(consts.RedisPassword)
	authType := strings.ToLower(strings.TrimSpace(os.Getenv(consts.RedisAuthType)))

	// When Redis is not configured at all (e.g. unit tests or deployments
	// that do not rely on Redis), return nil instead of panicking on a
	// Ping to ":0". Callers that require Redis must guard for nil; the
	// real startup path in di/infra sets REDIS_HOST explicitly, so the
	// fail-fast behavior on a misconfigured-but-set host is preserved
	// below.
	if host == "" {
		return nil
	}

	options := &redis.Options{
		Addr: host + ":" + port,
		DB:   0, // Default database

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
	}
	switch authType {
	case "", "password":
	case "azure":
		options.Username = ""
		options.Password = ""
		options.CredentialsProviderContext = redisCredentialProvider
		options.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	default:
		panic("unsupported Redis auth type: " + authType)
	}

	rdb := redis.NewClient(options)

	result := rdb.Ping(context.Background())
	if result.Err() != nil {
		panic("failed to connect to Redis: " + result.Err().Error())
	}

	redisFromEnvironment = rdb
	return rdb
}
