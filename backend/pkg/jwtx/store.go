package jwtx

import (
	"context"
	"time"

	"sico-backend/internal/infra/cache"
)

// Storer is the interface that storage the token.
type Storer interface {
	Set(ctx context.Context, tokenStr string, expiration time.Duration) error
	Delete(ctx context.Context, tokenStr string) error
	Check(ctx context.Context, tokenStr string) (bool, error)
	Close(ctx context.Context) error
}

type storeOptions struct {
	CacheNS string // default "jwt"
}

type StoreOption func(*storeOptions)

func WithCacheNS(ns string) StoreOption {
	return func(o *storeOptions) {
		o.CacheNS = ns
	}
}

func NewStoreWithCache(c cache.Cache, opts ...StoreOption) Storer {
	s := &storeImpl{
		c: c,
		opts: &storeOptions{
			CacheNS: "jwt",
		},
	}
	for _, opt := range opts {
		opt(s.opts)
	}
	return s
}

type storeImpl struct {
	opts *storeOptions
	c    cache.Cache
}

func (s *storeImpl) Set(ctx context.Context, tokenStr string, expiration time.Duration) error {
	return s.c.Set(ctx, s.opts.CacheNS, tokenStr, "", expiration)
}

func (s *storeImpl) Delete(ctx context.Context, tokenStr string) error {
	return s.c.Delete(ctx, s.opts.CacheNS, tokenStr)
}

func (s *storeImpl) Check(ctx context.Context, tokenStr string) (bool, error) {
	return s.c.Exists(ctx, s.opts.CacheNS, tokenStr)
}

func (s *storeImpl) Close(ctx context.Context) error {
	return s.c.Close(ctx)
}
