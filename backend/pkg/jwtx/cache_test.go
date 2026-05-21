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

package jwtx

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	memcache "sico-backend/internal/infra/cache/memory"
)

func TestStoreWithMemoryCache(t *testing.T) {
	store := NewStoreWithCache(memcache.New())
	ctx := context.Background()

	err := store.Set(ctx, "token-abc", 0)
	require.NoError(t, err)

	found, err := store.Check(ctx, "token-abc")
	require.NoError(t, err)
	assert.True(t, found)

	err = store.Delete(ctx, "token-abc")
	require.NoError(t, err)

	found, err = store.Check(ctx, "token-abc")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestStoreWithCustomNS(t *testing.T) {
	c := memcache.New()
	store := NewStoreWithCache(c, WithCacheNS("session"))
	ctx := context.Background()

	_ = store.Set(ctx, "tok", 0)

	// Default "jwt" namespace should not see this key.
	_, found, _ := c.Get(ctx, "jwt", "tok")
	assert.False(t, found)

	// Custom namespace should have it.
	_, found, _ = c.Get(ctx, "session", "tok")
	assert.True(t, found)
}

func TestStoreClose(t *testing.T) {
	store := NewStoreWithCache(memcache.New())
	err := store.Close(context.Background())
	assert.NoError(t, err)
}
