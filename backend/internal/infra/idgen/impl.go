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

package idgen

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"sico-backend/pkg/logger"
)

const (
	counterKeyExpirationTime = 10 * time.Minute
	maxCounterPosition       = 255
)

func NewIDGen(client *redis.Client) (IDGenerator, error) {
	return &idGenImpl{
		cli: client,
	}, nil
}

type idGenImpl struct {
	cli       *redis.Client
	namespace string
}

func (i *idGenImpl) GenID(ctx context.Context) (int64, error) {
	ids, err := i.GenMultiIDs(ctx, 1)
	if err != nil {
		return 0, err
	}

	return ids[0], nil
}

func (i *idGenImpl) GenMultiIDs(ctx context.Context, counts int) ([]int64, error) {
	const maxTimeAddrTimes = 8

	leftNum := int64(counts)
	lastMs := int64(0)
	ids := make([]int64, 0, counts)
	svrID := int64(0)

	for idx := int64(0); leftNum > 0 && idx < maxTimeAddrTimes; idx++ {
		ms := maxInt64(i.GetIDTimeMs(), lastMs)
		if ms <= lastMs {
			ms++
		}
		lastMs = ms

		newIDs, remaining, err := i.allocateIDs(ctx, ms, svrID, leftNum)
		if err != nil {
			return nil, err
		}
		ids = append(ids, newIDs...)
		leftNum = remaining
	}

	if len(ids) < counts || leftNum != 0 {
		logger.CtxError(
			ctx,
			"GenMultiIDs: ids num not enough, namespace=%v, expect=%v, gotten=%v, lastMs=%v",
			i.namespace, counts, len(ids), lastMs,
		)
		return nil, fmt.Errorf(
			"IDs num not enough, ns=%v, expect=%v, gotten=%v, lastMs=%v",
			i.namespace, counts, len(ids), lastMs,
		)
	}

	return ids, nil
}

// allocateIDs reserves a counter range for the given millisecond and returns
// the generated IDs along with how many IDs still need to be allocated.
func (i *idGenImpl) allocateIDs(ctx context.Context, ms, svrID, leftNum int64) ([]int64, int64, error) {
	redisKey := genIDKey(i.namespace, svrID, ms)

	counterPosition, err := i.IncrBy(ctx, redisKey, leftNum)
	if err != nil {
		return nil, leftNum, err
	}

	start := counterPosition - leftNum
	if start == 0 {
		i.Expire(ctx, redisKey)
	}

	if start > maxCounterPosition {
		return nil, leftNum, nil
	}
	if counterPosition < leftNum {
		return nil, leftNum, fmt.Errorf("recycling of counting space occurs, ms=%v", ms)
	}

	var end, remaining int64
	if counterPosition > maxCounterPosition {
		end = maxCounterPosition + 1
		remaining = counterPosition - maxCounterPosition - 1
	} else {
		end = counterPosition
		remaining = 0
	}

	seconds := ms / 1000
	millis := ms % 1000

	if seconds&0xFFFFFFFF != seconds {
		return nil, leftNum, fmt.Errorf("seconds more than 32 bits, seconds=%v", seconds)
	}
	if svrID&0x3FFF != svrID {
		return nil, leftNum, fmt.Errorf("server id more than 14 bits, serverID=%v", svrID)
	}

	out := make([]int64, 0, end-start)
	for n := start; n < end; n++ {
		id := (seconds)<<32 + (millis)<<22 + n<<14 + svrID
		out = append(out, id)
	}
	return out, remaining, nil
}

func (i *idGenImpl) IncrBy(ctx context.Context, key string, num int64) (cntPos int64, err error) {
	return i.cli.IncrBy(ctx, key, num).Result()
}

func (i *idGenImpl) GetIDTimeMs() int64 {
	return time.Now().UnixNano() / int64(time.Millisecond)
}

func (i *idGenImpl) Expire(ctx context.Context, key string) {
	_, _ = i.cli.Expire(ctx, key, counterKeyExpirationTime).Result()
}

func genIDKey(space string, svrID int64, ms int64) string {
	return fmt.Sprintf("id_generator:%v:%v:%v", space, svrID, ms)
}

func maxInt64(a, b int64) int64 {
	if a <= b {
		return b
	} else {
		return a
	}
}
