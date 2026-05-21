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

package memory

import (
	"context"
	"fmt"
	"sync"
	"time"

	"sico-backend/internal/infra/cache"
)

// Compile-time check.
var _ cache.Cache = (*MemoryCache)(nil)

type entry struct {
	value     string
	expiresAt time.Time // zero means no expiration
}

func (e *entry) expired(now time.Time) bool {
	return !e.expiresAt.IsZero() && now.After(e.expiresAt)
}

// MemoryCache is a thread-safe in-process cache backed by a plain map.
// It supports per-key TTL and a background sweep to evict expired entries.
type MemoryCache struct {
	mu      sync.RWMutex
	items   map[string]*entry
	closed  chan struct{}
	stopped sync.Once
}

// Option configures a MemoryCache.
type Option func(*MemoryCache)

// WithCleanupInterval starts a background goroutine that evicts expired
// entries at the given interval. Zero or negative disables the sweeper.
func WithCleanupInterval(d time.Duration) Option {
	return func(c *MemoryCache) {
		if d <= 0 {
			return
		}
		go c.sweepLoop(d)
	}
}

// New creates a MemoryCache. Call Close when the cache is no longer needed
// to stop the background sweeper (if enabled).
func New(opts ...Option) *MemoryCache {
	c := &MemoryCache{
		items:  make(map[string]*entry),
		closed: make(chan struct{}),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

func (c *MemoryCache) Set(_ context.Context, ns, key, value string, expiration ...time.Duration) error {
	var exp time.Duration
	if len(expiration) > 0 {
		exp = expiration[0]
	}

	e := &entry{value: value}
	if exp > 0 {
		e.expiresAt = time.Now().Add(exp)
	}

	c.mu.Lock()
	c.items[nsKey(ns, key)] = e
	c.mu.Unlock()
	return nil
}

func (c *MemoryCache) Get(_ context.Context, ns, key string) (string, bool, error) {
	c.mu.RLock()
	e, ok := c.items[nsKey(ns, key)]
	c.mu.RUnlock()

	if !ok {
		return "", false, nil
	}
	if e.expired(time.Now()) {
		// Lazy delete.
		c.mu.Lock()
		delete(c.items, nsKey(ns, key))
		c.mu.Unlock()
		return "", false, nil
	}
	return e.value, true, nil
}

func (c *MemoryCache) Exists(_ context.Context, ns, key string) (bool, error) {
	c.mu.RLock()
	e, ok := c.items[nsKey(ns, key)]
	c.mu.RUnlock()

	if !ok {
		return false, nil
	}
	if e.expired(time.Now()) {
		c.mu.Lock()
		delete(c.items, nsKey(ns, key))
		c.mu.Unlock()
		return false, nil
	}
	return true, nil
}

func (c *MemoryCache) Delete(_ context.Context, ns, key string) error {
	c.mu.Lock()
	delete(c.items, nsKey(ns, key))
	c.mu.Unlock()
	return nil
}

func (c *MemoryCache) Close(_ context.Context) error {
	c.stopped.Do(func() { close(c.closed) })
	return nil
}

// sweepLoop periodically removes expired entries.
func (c *MemoryCache) sweepLoop(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			c.evictExpired()
		case <-c.closed:
			return
		}
	}
}

func (c *MemoryCache) evictExpired() {
	now := time.Now()
	c.mu.Lock()
	for k, e := range c.items {
		if e.expired(now) {
			delete(c.items, k)
		}
	}
	c.mu.Unlock()
}

func nsKey(ns, key string) string {
	return fmt.Sprintf("%s:%s", ns, key)
}
