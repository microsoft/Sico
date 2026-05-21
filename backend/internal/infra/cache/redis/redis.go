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

package redis

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

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

	// When Redis is not configured at all (e.g. unit tests or deployments
	// that do not rely on Redis), return nil instead of panicking on a
	// Ping to ":0". Callers that require Redis must guard for nil; the
	// real startup path in di/infra sets REDIS_HOST explicitly, so the
	// fail-fast behavior on a misconfigured-but-set host is preserved
	// below.
	if host == "" {
		return nil
	}

	rdb := redis.NewClient(&redis.Options{
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
	})

	result := rdb.Ping(context.Background())
	if result.Err() != nil {
		panic("failed to connect to Redis: " + result.Err().Error())
	}

	redisFromEnvironment = rdb
	return rdb
}
