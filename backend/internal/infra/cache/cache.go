package cache

import (
	"context"
	"time"
)

// Cache defines a namespaced key-value cache used across the application.
// Implementations may be backed by Redis, in-memory stores, or other backends.
type Cache interface {
	// Set stores a value under the given namespace and key with an optional TTL.
	Set(ctx context.Context, ns, key, value string, expiration ...time.Duration) error
	// Get retrieves a value. Returns ("", false, nil) on cache miss.
	Get(ctx context.Context, ns, key string) (string, bool, error)
	// Exists checks whether the key exists in the given namespace.
	Exists(ctx context.Context, ns, key string) (bool, error)
	// Delete removes a key from the given namespace.
	Delete(ctx context.Context, ns, key string) error
	// Close releases any resources held by the cache.
	Close(ctx context.Context) error
}
