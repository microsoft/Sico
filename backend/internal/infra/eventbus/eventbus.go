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

package eventbus

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sico-backend/internal/consts"
	"strings"
	"sync"
	"time"
)

const (
	defaultSubscriptionPrefix = "backend-broadcast"
)

type EventBusMessage struct {
	Payload   []byte
	MessageId string
}

type EventBusSubscription interface {
	Close() error
}

// EventHandler is invoked for each message delivered to a subscription.
type EventHandler = func(ctx context.Context, message *EventBusMessage) error

type EventBus interface {
	Subscribe(
		ctx context.Context,
		topic string,
		subscriptionPrefix string,
		handler EventHandler,
	) (EventBusSubscription, error)
}

var defaultEventBus EventBus
var defaultEventBusInitializationOnce sync.Once

func Default() EventBus {
	if defaultEventBus == nil {
		defaultEventBusInitializationOnce.Do(func() {
			eventBusType := os.Getenv(consts.EventBusType)
			switch eventBusType {
			case "kafka":
				initialized, err := newKafkaEventBus()
				if err != nil {
					panic(fmt.Sprintf("failed to initialize default event bus: %v", err))
				}
				defaultEventBus = initialized
			default:
				panic("unsupported event bus type: " + eventBusType)
			}
		})
	}
	return defaultEventBus
}

func sanitizeSubscriptionName(input string) string {
	clean := strings.ToLower(strings.TrimSpace(input))
	re := regexp.MustCompile(`[^a-z0-9-]`)
	clean = re.ReplaceAllString(clean, "-")
	clean = strings.Trim(clean, "-")
	if clean == "" {
		return defaultSubscriptionPrefix + "-default"
	}
	// replace all "-" to "_" because Kafka groupId does not allow "-"
	clean = strings.ReplaceAll(clean, "-", "_")
	return clean
}

func buildSubscriptionNameFromEnv(prefix string) string {
	if prefix == "" {
		prefix = defaultSubscriptionPrefix
	}

	replicaID := strings.TrimSpace(os.Getenv("POD_NAME"))
	if replicaID == "" {
		replicaID = strings.TrimSpace(os.Getenv("HOSTNAME"))
	}
	if replicaID == "" {
		replicaID = strings.TrimSpace(os.Getenv("POD_UID"))
	}
	if replicaID == "" {
		replicaID = fmt.Sprintf("local_%d", time.Now().Unix())
	}

	name := sanitizeSubscriptionName(prefix + "_" + replicaID)
	if len(name) > 50 {
		name = name[:50]
	}
	return name
}
