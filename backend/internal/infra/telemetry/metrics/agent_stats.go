package metrics

import (
	"context"
	"strconv"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"gorm.io/gorm"

	"sico-backend/internal/transport/http/dto/agent/single_agent"
	"sico-backend/pkg/env"
	"sico-backend/pkg/logger"
)

const defaultAgentInstanceLimit = 1000

var agentStatsOnce sync.Once

type agentStatsState struct {
	mu            sync.RWMutex
	lastInstances []agentInstance
}

type agentInstance struct {
	ID     int64
	Status single_agent.SingleAgentInstanceStatus
	Role   string
}

func RegisterAgentStats(db *gorm.DB) {
	agentStatsOnce.Do(func() {
		if db == nil {
			logger.Error("agent metrics not registered: db is nil")
			return
		}

		meter := otel.Meter("sico-backend/agent")
		instanceGauge, err := meter.Int64ObservableGauge(
			"sico.agent.instance",
			metric.WithUnit("{instance}"),
			metric.WithDescription("Per agent instance with instance_id, role, and status dimensions."),
		)
		if err != nil {
			logger.Error("create gauge sico.agent.instance failed: %v", err)
			return
		}

		_, err = meter.RegisterCallback(
			agentStatsCallback(&agentStatsState{}, db, agentInstanceLimit(), instanceGauge),
			instanceGauge,
		)
		if err != nil {
			logger.Error("register agent metrics callback failed: %v", err)
		}
	})
}

func agentStatsCallback(
	state *agentStatsState,
	db *gorm.DB,
	instanceLimit int,
	instanceGauge metric.Int64Observable,
) func(context.Context, metric.Observer) error {
	return func(ctx context.Context, observer metric.Observer) error {
		queryCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
		defer cancel()

		instances, err := queryAgentInstances(queryCtx, db, instanceLimit)
		if err == nil {
			state.mu.Lock()
			state.lastInstances = instances
			state.mu.Unlock()
		} else {
			logger.CtxWarn(ctx, "query agent instance metrics failed: %v", err)
		}

		state.mu.RLock()
		defer state.mu.RUnlock()
		for _, instance := range state.lastInstances {
			observer.ObserveInt64(instanceGauge, 1, metric.WithAttributes(
				attribute.String("instance_id", strconv.FormatInt(instance.ID, 10)),
				attribute.String("role", normalizedAgentRole(instance.Role)),
				attribute.String("status", instance.Status.String()),
			))
		}
		return nil
	}
}

func queryAgentInstances(ctx context.Context, db *gorm.DB, limit int) ([]agentInstance, error) {
	type row struct {
		ID     int64
		Status int32
		Role   string
	}
	var rows []row
	query := "SELECT id, status, role FROM t_single_agent_instance WHERE deleted_at IS NULL ORDER BY id"
	if limit > 0 {
		query += " LIMIT " + strconv.Itoa(limit)
	}
	if err := db.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
		return nil, err
	}

	instances := make([]agentInstance, 0, len(rows))
	for _, current := range rows {
		instances = append(instances, agentInstance{
			ID:     current.ID,
			Status: single_agent.SingleAgentInstanceStatus(current.Status),
			Role:   current.Role,
		})
	}
	return instances, nil
}

func agentInstanceLimit() int {
	value, ok := env.Get("SICO_METRICS_AGENT_INSTANCE_LIMIT")
	if !ok {
		return defaultAgentInstanceLimit
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit <= 0 {
		return defaultAgentInstanceLimit
	}
	return limit
}

func normalizedAgentRole(role string) string {
	if role == "" {
		return "Unknown"
	}
	return role
}
