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

package sse

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	"sico-backend/pkg/safego"
)

type Event struct {
	Event string
	Data  []byte
}

type SSESender interface {
	Send(ctx context.Context, event *Event) error
	NotifyClosed()
	Done() bool
}

func NewSSESender(c *gin.Context) SSESender {
	return NewGinSSESender(c)
}

type timestampedData struct {
	Timestamp int64 `json:"timestamp"`
}

func UseKeepalive(ctx context.Context, sseSender SSESender, interval time.Duration) {
	safego.Go(ctx, func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				// If is already disconnected, return
				if sseSender.Done() {
					return
				}
				// Send a comment (SSE spec: lines starting with ':' are ignored by client)
				data := timestampedData{
					Timestamp: time.Now().UnixMilli(),
				}
				payload, _ := json.Marshal(data)
				_ = sseSender.Send(ctx, &Event{
					Event: "keepalive",
					Data:  payload,
				})
			}
		}
	})
}
