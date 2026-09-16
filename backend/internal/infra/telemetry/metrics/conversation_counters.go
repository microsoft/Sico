package metrics

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"sico-backend/pkg/logger"
)

var conversationCountersOnce sync.Once

var messagesCreatedCounter metric.Int64Counter

func InitConversationCounters() {
	conversationCountersOnce.Do(func() {
		var err error
		messagesCreatedCounter, err = otel.Meter("sico-backend/conversation").Int64Counter(
			"sico.conversation.messages_created",
			metric.WithUnit("{message}"),
			metric.WithDescription("Messages created."),
		)
		if err != nil {
			logger.Error("create counter sico.conversation.messages_created failed: %v", err)
		}
	})
}

func RecordMessageCreated(ctx context.Context, role string) {
	if messagesCreatedCounter == nil {
		return
	}
	if role == "" {
		role = "unknown"
	}
	messagesCreatedCounter.Add(ctx, 1, metric.WithAttributes(attribute.String("role", role)))
}
