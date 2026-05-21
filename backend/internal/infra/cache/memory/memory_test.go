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
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryCache_SetAndGet(t *testing.T) {
	c := New()
	ctx := context.Background()

	err := c.Set(ctx, "ns", "k1", "v1")
	require.NoError(t, err)

	val, found, err := c.Get(ctx, "ns", "k1")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "v1", val)
}

func TestMemoryCache_Miss(t *testing.T) {
	c := New()
	val, found, err := c.Get(context.Background(), "ns", "missing")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, "", val)
}

func TestMemoryCache_Expiration(t *testing.T) {
	c := New()
	ctx := context.Background()

	err := c.Set(ctx, "ns", "ttl", "val", 50*time.Millisecond)
	require.NoError(t, err)

	val, found, err := c.Get(ctx, "ns", "ttl")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "val", val)

	time.Sleep(60 * time.Millisecond)

	_, found, err = c.Get(ctx, "ns", "ttl")
	require.NoError(t, err)
	assert.False(t, found, "key should have expired")
}

func TestMemoryCache_ExpirationViaExists(t *testing.T) {
	c := New()
	ctx := context.Background()

	_ = c.Set(ctx, "ns", "k", "v", 50*time.Millisecond)
	time.Sleep(60 * time.Millisecond)

	exists, err := c.Exists(ctx, "ns", "k")
	require.NoError(t, err)
	assert.False(t, exists)
}

func TestMemoryCache_NoExpiration(t *testing.T) {
	c := New()
	ctx := context.Background()

	_ = c.Set(ctx, "ns", "forever", "val")

	val, found, _ := c.Get(ctx, "ns", "forever")
	assert.True(t, found)
	assert.Equal(t, "val", val)
}

func TestMemoryCache_Overwrite(t *testing.T) {
	c := New()
	ctx := context.Background()

	_ = c.Set(ctx, "ns", "k", "v1")
	_ = c.Set(ctx, "ns", "k", "v2")

	val, _, _ := c.Get(ctx, "ns", "k")
	assert.Equal(t, "v2", val)
}

func TestMemoryCache_Exists(t *testing.T) {
	c := New()
	ctx := context.Background()

	exists, _ := c.Exists(ctx, "ns", "k")
	assert.False(t, exists)

	_ = c.Set(ctx, "ns", "k", "v")
	exists, _ = c.Exists(ctx, "ns", "k")
	assert.True(t, exists)
}

func TestMemoryCache_Delete(t *testing.T) {
	c := New()
	ctx := context.Background()

	_ = c.Set(ctx, "ns", "k", "v")
	err := c.Delete(ctx, "ns", "k")
	require.NoError(t, err)

	_, found, _ := c.Get(ctx, "ns", "k")
	assert.False(t, found)
}

func TestMemoryCache_DeleteNonexistent(t *testing.T) {
	c := New()
	err := c.Delete(context.Background(), "ns", "nope")
	assert.NoError(t, err)
}

func TestMemoryCache_NamespaceIsolation(t *testing.T) {
	c := New()
	ctx := context.Background()

	_ = c.Set(ctx, "a", "k", "va")
	_ = c.Set(ctx, "b", "k", "vb")

	va, _, _ := c.Get(ctx, "a", "k")
	vb, _, _ := c.Get(ctx, "b", "k")
	assert.Equal(t, "va", va)
	assert.Equal(t, "vb", vb)
}

func TestMemoryCache_Close(t *testing.T) {
	c := New(WithCleanupInterval(10 * time.Millisecond))
	err := c.Close(context.Background())
	assert.NoError(t, err)

	// Double close is safe.
	err = c.Close(context.Background())
	assert.NoError(t, err)
}

func TestMemoryCache_SweeperEvictsExpired(t *testing.T) {
	c := New(WithCleanupInterval(20 * time.Millisecond))
	defer func() {
		assert.NoError(t, c.Close(context.Background()))
	}()
	ctx := context.Background()

	_ = c.Set(ctx, "ns", "a", "1", 30*time.Millisecond)
	_ = c.Set(ctx, "ns", "b", "2") // no expiration

	time.Sleep(60 * time.Millisecond)

	c.mu.RLock()
	_, aExists := c.items["ns:a"]
	_, bExists := c.items["ns:b"]
	c.mu.RUnlock()

	assert.False(t, aExists, "expired key should have been swept")
	assert.True(t, bExists, "non-expiring key should remain")
}

func TestMemoryCache_ConcurrentAccess(t *testing.T) {
	c := New()
	ctx := context.Background()
	done := make(chan struct{})

	// Hammer the cache from multiple goroutines.
	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- struct{}{} }()
			key := "k"
			for j := 0; j < 100; j++ {
				_ = c.Set(ctx, "ns", key, "v")
				_, _, _ = c.Get(ctx, "ns", key)
				_, _ = c.Exists(ctx, "ns", key)
				_ = c.Delete(ctx, "ns", key)
			}
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}
}
