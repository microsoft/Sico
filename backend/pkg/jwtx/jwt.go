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
	"encoding/json"
	"errors"
	"math/rand"
	"time"

	"github.com/golang-jwt/jwt/v4"

	"sico-backend/pkg/logger"
)

// UserInfo represents the authenticated user information.
type UserInfo struct {
	OID      string   `json:"oid"`       // Object ID
	Name     string   `json:"name"`      // Unique name
	Email    string   `json:"email"`     // Email address
	TenantID string   `json:"tenant_id"` // Tenant ID
	IAT      int64    `json:"iat"`       // Issued at
	NBF      int64    `json:"nbf"`       // Not before
	EXP      int64    `json:"exp"`       // Expires at
	Roles    []string `json:"roles"`     // User roles
	Groups   []string `json:"groups"`    // User groups
	UserID   int64    `json:"user_id"`   // User ID, can be used for internal tracking
}

type Auther interface {
	// GenerateToken Generate a JWT (JSON Web Token) with the provided subject.
	GenerateToken(ctx context.Context, userInfo *UserInfo) (TokenInfo, error)
	// DestroyToken Invalidate a token by removing it from the token store.
	DestroyToken(ctx context.Context, accessToken string) error
	// ParseSubject Parse the subject (or user identifier) from a given access token.
	ParseSubject(ctx context.Context, accessToken string) (*UserInfo, error)
	// Release any resources held by the JWTAuth instance.
	Release(ctx context.Context) error
}

const defaultKey = "CG24SDVP8OHPK395GB5G"

var ErrInvalidToken = errors.New("invalid token")

type options struct {
	signingMethod jwt.SigningMethod
	signingKey    []byte
	keyFunc       func(*jwt.Token) (interface{}, error)
	expired       int
	tokenType     string
}

type Option func(*options)

func SetSigningMethod(method jwt.SigningMethod) Option {
	return func(o *options) {
		o.signingMethod = method
	}
}

func SetSigningKey(key string) Option {
	return func(o *options) {
		o.signingKey = []byte(key)
	}
}

func SetExpired(expired int) Option {
	return func(o *options) {
		o.expired = expired
	}
}

func New(store Storer, opts ...Option) Auther {
	o := options{
		tokenType:     "Bearer",
		expired:       86400,
		signingMethod: jwt.SigningMethodHS512,
		signingKey:    []byte(defaultKey),
	}

	for _, opt := range opts {
		opt(&o)
	}

	o.keyFunc = func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}

		return o.signingKey, nil
	}

	return &JWTAuth{
		opts:  &o,
		store: store,
	}
}

type JWTAuth struct {
	opts  *options
	store Storer
}

func (a *JWTAuth) GenerateToken(_ context.Context, userInfo *UserInfo) (TokenInfo, error) {
	now := time.Now()
	expiresAt := now.Add(time.Duration(a.opts.expired) * time.Second)
	bs, err := json.Marshal(userInfo)
	if err != nil {
		return nil, err
	}

	token := jwt.NewWithClaims(a.opts.signingMethod, &jwt.RegisteredClaims{
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(expiresAt),
		NotBefore: jwt.NewNumericDate(now),
		Subject:   string(bs),
		Audience:  jwt.ClaimStrings{generateRandomString(16)},
	})

	tokenStr, err := token.SignedString(a.opts.signingKey)
	if err != nil {
		return nil, err
	}

	tokenInfo := &tokenInfo{
		ExpiresAt:   expiresAt.Unix(),
		TokenType:   a.opts.tokenType,
		AccessToken: tokenStr,
	}

	return tokenInfo, nil
}

func generateRandomString(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return string(b)
}

func (a *JWTAuth) parseToken(tokenStr string) (*UserInfo, error) {
	var (
		token *jwt.Token
		err   error
	)

	token, err = jwt.ParseWithClaims(tokenStr, &jwt.RegisteredClaims{}, a.opts.keyFunc)
	if err != nil || token == nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	var u UserInfo
	err = json.Unmarshal([]byte(claims.Subject), &u)
	if err != nil {
		return nil, err
	}

	if claims.ExpiresAt != nil {
		u.EXP = claims.ExpiresAt.Unix()
	}

	return &u, nil
}

func (a *JWTAuth) callStore(fn func(Storer) error) error {
	if store := a.store; store != nil {
		return fn(store)
	}

	return nil
}

func (a *JWTAuth) DestroyToken(ctx context.Context, tokenStr string) error {
	userInfo, err := a.parseToken(tokenStr)
	if err != nil {
		return err
	}

	return a.callStore(func(store Storer) error {
		expired := time.Until(time.Unix(userInfo.EXP, 0))
		return store.Set(ctx, tokenStr, expired)
	})
}

func (a *JWTAuth) ParseSubject(ctx context.Context, tokenStr string) (*UserInfo, error) {
	if len(tokenStr) == 0 {
		return nil, ErrInvalidToken
	}

	userInfo, err := a.parseToken(tokenStr)
	if err != nil || userInfo == nil {
		return nil, ErrInvalidToken
	}

	err = a.callStore(func(store Storer) error {
		if exists, err := store.Check(ctx, tokenStr); err != nil {
			logger.CtxError(ctx, "JWTAuth store check failed: %v", err)
			return nil
		} else if exists {
			return ErrInvalidToken
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return userInfo, nil
}

func (a *JWTAuth) Release(ctx context.Context) error {
	return a.callStore(func(store Storer) error {
		return store.Close(ctx)
	})
}
