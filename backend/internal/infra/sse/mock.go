package sse

import "context"

type MockSSESender struct {
	Sent []*Event
	done bool
}

func NewMockSSESender() *MockSSESender {
	return &MockSSESender{
		Sent: []*Event{},
		done: false,
	}
}

func (m *MockSSESender) Send(ctx context.Context, event *Event) error {
	m.Sent = append(m.Sent, event)
	return nil
}

func (m *MockSSESender) NotifyClosed() {
	m.done = true
}

func (m *MockSSESender) Done() bool {
	return m.done
}
