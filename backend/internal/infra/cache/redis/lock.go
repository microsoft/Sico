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
	"sico-backend/internal/consts"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func AcquireLockNonblockingWithValue(ctx context.Context, rds *redis.Client, key, value string, expiration ...int) (bool, error) {
	var exp int64 = 30 // default 30 seconds
	if len(expiration) > 0 {
		exp = int64(expiration[0])
	}
	script := `
        if redis.call("SETNX", KEYS[1], ARGV[1]) == 1 then
            redis.call("EXPIRE", KEYS[1], ARGV[2])
            return 1
        elseif redis.call("GET", KEYS[1]) == ARGV[1] then
            redis.call("EXPIRE", KEYS[1], ARGV[2])
            return 1
        else
            return 0
        end
	`

	res, err := rds.Eval(ctx, script, []string{key}, value, exp).Result()
	if err != nil {
		return false, err
	}
	acquired, ok := res.(int64)
	if !ok {
		return false, nil
	}
	return acquired == 1, nil
}

func AcquireLockNonblocking(ctx context.Context, rds *redis.Client, key string, expiration ...int) (bool, string, error) {
	value := uuid.New().String()
	acquired, err := AcquireLockNonblockingWithValue(ctx, rds, key, value, expiration...)
	if err != nil {
		return false, "", err
	}
	return acquired, value, nil
}

func ReleaseLock(ctx context.Context, rds *redis.Client, key, value string) error {
	script := `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
	`

	_, err := rds.Eval(ctx, script, []string{key}, value).Result()
	return err
}

func AcquireLockBlocking(ctx context.Context, rds *redis.Client, key string, expiration ...int) (string, error) {
	// exponential backoff retry
	waitTime := consts.RedisLockInitialWaitTime
	for {
		acquired, value, err := AcquireLockNonblocking(ctx, rds, key, expiration...)
		if err != nil {
			return "", err
		}
		if acquired {
			return value, nil
		}
		// wait and retry
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(waitTime):
			waitTime *= 2
			if waitTime > consts.RedisLockMaxWaitTime {
				waitTime = consts.RedisLockMaxWaitTime
			}
		}
	}
}

type RedisLock struct {
	rds   *redis.Client
	key   string
	value string
}

func NewRedisLock(rds *redis.Client, key string) *RedisLock {
	return &RedisLock{
		rds: rds,
		key: key,
	}
}

func (l *RedisLock) Lock(ctx context.Context, expiration ...int) error {
	value, err := AcquireLockBlocking(ctx, l.rds, l.key, expiration...)
	if err != nil {
		return err
	}

	l.value = value
	return nil
}

func (l *RedisLock) Unlock(ctx context.Context) error {
	return ReleaseLock(ctx, l.rds, l.key, l.value)
}
