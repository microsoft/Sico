package metrics

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"gorm.io/gorm"

	"sico-backend/pkg/logger"
)

const messageReQueryInterval = 5 * time.Minute

var conversationStatsOnce sync.Once

type conversationStatsState struct {
	mu                    sync.RWMutex
	lastConversationCount int64
	lastMessages          []messageRoleRow
	lastMessageQueryAt    time.Time
}

type messageRoleRow struct {
	Role  string
	Count int64
}

func RegisterConversationStats(db *gorm.DB) {
	conversationStatsOnce.Do(func() {
		if db == nil {
			logger.Error("conversation metrics not registered: db is nil")
			return
		}

		meter := otel.Meter("sico-backend/conversation")
		conversationGauge, err := meter.Int64ObservableGauge(
			"sico.conversation.total",
			metric.WithUnit("{conversation}"),
			metric.WithDescription("Total active conversations."),
		)
		if err != nil {
			logger.Error("create gauge sico.conversation.total failed: %v", err)
			return
		}
		messageGauge, err := meter.Int64ObservableGauge(
			"sico.conversation.messages_total",
			metric.WithUnit("{message}"),
			metric.WithDescription("Total messages grouped by role."),
		)
		if err != nil {
			logger.Error("create gauge sico.conversation.messages_total failed: %v", err)
			return
		}

		state := &conversationStatsState{}
		_, err = meter.RegisterCallback(
			conversationStatsCallback(state, db, conversationGauge, messageGauge),
			conversationGauge,
			messageGauge,
		)
		if err != nil {
			logger.Error("register conversation metrics callback failed: %v", err)
		}
	})
}

func conversationStatsCallback(
	state *conversationStatsState,
	db *gorm.DB,
	conversationGauge metric.Int64Observable,
	messageGauge metric.Int64Observable,
) func(context.Context, metric.Observer) error {
	return func(ctx context.Context, observer metric.Observer) error {
		now := time.Now()
		queryMessages := state.messageStatsStale(now)
		queryCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
		defer cancel()

		conversationCount, err := queryConversationCount(queryCtx, db)
		if err == nil {
			state.mu.Lock()
			state.lastConversationCount = conversationCount
			state.mu.Unlock()
		} else {
			logger.CtxWarn(ctx, "query conversation count metric failed: %v", err)
		}

		if queryMessages {
			messages, messageErr := queryMessageStats(queryCtx, db)
			if messageErr == nil {
				state.mu.Lock()
				state.lastMessages = messages
				state.lastMessageQueryAt = now
				state.mu.Unlock()
			} else {
				logger.CtxWarn(ctx, "query message count metrics failed: %v", messageErr)
			}
		}

		state.mu.RLock()
		defer state.mu.RUnlock()
		observer.ObserveInt64(conversationGauge, state.lastConversationCount)
		for _, message := range state.lastMessages {
			observer.ObserveInt64(messageGauge, message.Count, metric.WithAttributes(
				attribute.String("role", message.Role),
			))
		}
		return nil
	}
}

func (state *conversationStatsState) messageStatsStale(now time.Time) bool {
	state.mu.RLock()
	defer state.mu.RUnlock()
	return state.lastMessageQueryAt.IsZero() || now.Sub(state.lastMessageQueryAt) >= messageReQueryInterval
}

func queryConversationCount(ctx context.Context, db *gorm.DB) (int64, error) {
	var count int64
	err := db.WithContext(ctx).
		Raw("SELECT COUNT(*) FROM t_conversation WHERE deleted_at IS NULL").
		Scan(&count).Error
	return count, err
}

func queryMessageStats(ctx context.Context, db *gorm.DB) ([]messageRoleRow, error) {
	var rows []messageRoleRow
	err := db.WithContext(ctx).
		Raw("SELECT role, COUNT(*) AS count FROM t_message GROUP BY role").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for index := range rows {
		if rows[index].Role == "" {
			rows[index].Role = "unknown"
		}
	}
	return rows, nil
}
