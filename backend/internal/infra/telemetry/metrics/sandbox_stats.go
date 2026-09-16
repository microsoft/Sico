package metrics

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"sico-backend/pkg/logger"
)

var sandboxStatsOnce sync.Once

type SandboxMetricsProvider interface {
	MetricsSnapshot(ctx context.Context) (*SandboxSnapshot, error)
}

type SandboxSnapshot struct {
	ResourcesByTypeStatus map[string]map[string]int64
	ProviderHealthy       map[string]int64
}

type sandboxStatsState struct {
	mu           sync.RWMutex
	lastSnapshot *SandboxSnapshot
}

func RegisterSandboxStats(provider SandboxMetricsProvider) {
	sandboxStatsOnce.Do(func() {
		if provider == nil {
			logger.Error("sandbox metrics not registered: provider is nil")
			return
		}

		meter := otel.Meter("sico-backend/sandbox")
		resourcesGauge, err := meter.Int64ObservableGauge(
			"sico.sandbox.resources_total",
			metric.WithUnit("{resource}"),
			metric.WithDescription("Total sandbox resources grouped by type and status."),
		)
		if err != nil {
			logger.Error("create gauge sico.sandbox.resources_total failed: %v", err)
			return
		}
		providerHealthGauge, err := meter.Int64ObservableGauge(
			"sico.sandbox.provider_healthy",
			metric.WithUnit("1"),
			metric.WithDescription("Sandbox provider health: 1=healthy, 0=unhealthy."),
		)
		if err != nil {
			logger.Error("create gauge sico.sandbox.provider_healthy failed: %v", err)
			return
		}

		_, err = meter.RegisterCallback(
			sandboxStatsCallback(&sandboxStatsState{}, provider, resourcesGauge, providerHealthGauge),
			resourcesGauge,
			providerHealthGauge,
		)
		if err != nil {
			logger.Error("register sandbox metrics callback failed: %v", err)
		}
	})
}

func sandboxStatsCallback(
	state *sandboxStatsState,
	provider SandboxMetricsProvider,
	resourcesGauge metric.Int64Observable,
	providerHealthGauge metric.Int64Observable,
) func(context.Context, metric.Observer) error {
	return func(ctx context.Context, observer metric.Observer) error {
		queryCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
		defer cancel()

		snapshot, err := provider.MetricsSnapshot(queryCtx)
		if err == nil && snapshot != nil {
			state.mu.Lock()
			state.lastSnapshot = snapshot
			state.mu.Unlock()
		} else if err != nil {
			logger.CtxWarn(ctx, "query sandbox metrics snapshot failed: %v", err)
		}

		state.mu.RLock()
		defer state.mu.RUnlock()
		if state.lastSnapshot == nil {
			return nil
		}
		for sandboxType, statusCounts := range state.lastSnapshot.ResourcesByTypeStatus {
			for status, count := range statusCounts {
				observer.ObserveInt64(resourcesGauge, count, metric.WithAttributes(
					attribute.String("sandbox_type", sandboxType),
					attribute.String("status", status),
				))
			}
		}
		for sandboxType, healthy := range state.lastSnapshot.ProviderHealthy {
			observer.ObserveInt64(providerHealthGauge, healthy, metric.WithAttributes(
				attribute.String("sandbox_type", sandboxType),
			))
		}
		return nil
	}
}
