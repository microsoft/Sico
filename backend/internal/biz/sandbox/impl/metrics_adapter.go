package impl

import (
	"context"

	telemetrymetrics "sico-backend/internal/infra/telemetry/metrics"
)

type poolMetricsAdapter struct {
	pool *Pool
}

func (adapter *poolMetricsAdapter) MetricsSnapshot(ctx context.Context) (*telemetrymetrics.SandboxSnapshot, error) {
	snapshot, err := adapter.pool.MetricsSnapshot(ctx)
	if err != nil {
		return nil, err
	}
	return &telemetrymetrics.SandboxSnapshot{
		ResourcesByTypeStatus: snapshot.ResourcesByTypeStatus,
		ProviderHealthy:       snapshot.ProviderHealthy,
	}, nil
}

func NewMetricsAdapter(pool *Pool) telemetrymetrics.SandboxMetricsProvider {
	if pool == nil {
		return nil
	}
	return &poolMetricsAdapter{pool: pool}
}
