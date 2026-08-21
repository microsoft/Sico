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
