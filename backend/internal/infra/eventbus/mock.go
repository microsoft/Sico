package eventbus

import (
	"context"
	"fmt"
	"sico-backend/pkg/logger"
	"sync"
	"sync/atomic"
)

// MockEventBus is a mock implementation of EventBus for testing.
type MockEventBus struct {
	mu            sync.Mutex
	subscriptions []*MockEventBusSubscription
}

// MockEventBusSubscription implements EventBusSubscription and exposes a Send
// method so tests can inject messages into the handler.
type MockEventBusSubscription struct {
	topicName string
	handler   func(ctx context.Context, message *EventBusMessage) error
	ctx       context.Context
	cancel    context.CancelFunc
	closed    atomic.Bool
}

func NewMockEventBus() *MockEventBus {
	return &MockEventBus{}
}

func (m *MockEventBus) Subscribe(
	ctx context.Context,
	topic string,
	subscriptionPrefix string,
	handler EventHandler,
) (EventBusSubscription, error) {
	subCtx, cancel := context.WithCancel(ctx)
	sub := &MockEventBusSubscription{
		topicName: topic,
		handler:   handler,
		ctx:       subCtx,
		cancel:    cancel,
	}

	m.mu.Lock()
	m.subscriptions = append(m.subscriptions, sub)
	m.mu.Unlock()

	return sub, nil
}

// Subscriptions returns all active subscriptions for inspection in tests.
func (m *MockEventBus) Subscriptions() []*MockEventBusSubscription {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]*MockEventBusSubscription, len(m.subscriptions))
	copy(out, m.subscriptions)
	return out
}

// Send delivers a message to the subscription's handler, simulating a received event.
func (m *MockEventBus) Send(topic string, payload []byte, messageId string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.subscriptions) == 0 {
		return fmt.Errorf("no subscriptions available")
	}
	for _, sub := range m.subscriptions {
		if sub.topicName == topic {
			if sub.closed.Load() {
				return fmt.Errorf("subscription is closed")
			}
			err := sub.handler(sub.ctx, &EventBusMessage{
				Payload:   payload,
				MessageId: messageId,
			})
			if err != nil {
				logger.Warn("handler error: %v", err)
			}
		}
	}
	return nil
}

func (s *MockEventBusSubscription) Topic() string {
	return s.topicName
}

func (s *MockEventBusSubscription) Close() error {
	if s.closed.CompareAndSwap(false, true) {
		s.cancel()
	}
	return nil
}
