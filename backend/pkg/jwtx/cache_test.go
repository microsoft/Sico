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
