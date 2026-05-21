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
