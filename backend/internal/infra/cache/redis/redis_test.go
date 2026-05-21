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
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/alicebob/miniredis/v2"
	redisclient "github.com/redis/go-redis/v9"
)

func newTestCache(t *testing.T) (*RedisCache, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redisclient.NewClient(&redisclient.Options{Addr: mr.Addr()})
	return New(client), mr
}

func TestRedisCache_SetAndGet(t *testing.T) {
	c, _ := newTestCache(t)
	ctx := context.Background()

	err := c.Set(ctx, "ns", "key1", "value1")
	require.NoError(t, err)

	val, found, err := c.Get(ctx, "ns", "key1")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "value1", val)
}

func TestRedisCache_GetMiss(t *testing.T) {
	c, _ := newTestCache(t)
	ctx := context.Background()

	val, found, err := c.Get(ctx, "ns", "nonexistent")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, "", val)
}

func TestRedisCache_SetWithTTL(t *testing.T) {
	c, mr := newTestCache(t)
	ctx := context.Background()

	err := c.Set(ctx, "ns", "ttl-key", "val", 1*time.Second)
	require.NoError(t, err)

	val, found, err := c.Get(ctx, "ns", "ttl-key")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "val", val)

	// Fast-forward miniredis past TTL
	mr.FastForward(2 * time.Second)

	_, found, err = c.Get(ctx, "ns", "ttl-key")
	require.NoError(t, err)
	assert.False(t, found, "key should have expired")
}

func TestRedisCache_Exists(t *testing.T) {
	c, _ := newTestCache(t)
	ctx := context.Background()

	exists, err := c.Exists(ctx, "ns", "key")
	require.NoError(t, err)
	assert.False(t, exists)

	_ = c.Set(ctx, "ns", "key", "v")

	exists, err = c.Exists(ctx, "ns", "key")
	require.NoError(t, err)
	assert.True(t, exists)
}

func TestRedisCache_Delete(t *testing.T) {
	c, _ := newTestCache(t)
	ctx := context.Background()

	_ = c.Set(ctx, "ns", "del-key", "val")
	err := c.Delete(ctx, "ns", "del-key")
	require.NoError(t, err)

	_, found, _ := c.Get(ctx, "ns", "del-key")
	assert.False(t, found)
}

func TestRedisCache_DeleteNonexistent(t *testing.T) {
	c, _ := newTestCache(t)
	err := c.Delete(context.Background(), "ns", "nope")
	assert.NoError(t, err, "deleting a nonexistent key should not error")
}

func TestRedisCache_NamespaceIsolation(t *testing.T) {
	c, _ := newTestCache(t)
	ctx := context.Background()

	_ = c.Set(ctx, "ns1", "key", "v1")
	_ = c.Set(ctx, "ns2", "key", "v2")

	v1, _, _ := c.Get(ctx, "ns1", "key")
	v2, _, _ := c.Get(ctx, "ns2", "key")
	assert.Equal(t, "v1", v1)
	assert.Equal(t, "v2", v2)
}

func TestRedisCache_Close(t *testing.T) {
	c, _ := newTestCache(t)
	err := c.Close(context.Background())
	assert.NoError(t, err)
}

func TestRedisCache_CloseNilClient(t *testing.T) {
	c := &RedisCache{client: nil}
	err := c.Close(context.Background())
	assert.NoError(t, err)
}

func TestNsKey(t *testing.T) {
	assert.Equal(t, "jwt:token123", nsKey("jwt", "token123"))
	assert.Equal(t, ":key", nsKey("", "key"))
}
