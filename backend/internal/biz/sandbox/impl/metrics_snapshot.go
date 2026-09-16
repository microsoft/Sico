package impl

import (
	"context"
	"time"
)

type SandboxMetricsSnapshot struct {
	ResourcesByTypeStatus map[string]map[string]int64
	ProviderHealthy       map[string]int64
}

func (p *Pool) MetricsSnapshot(ctx context.Context) (*SandboxMetricsSnapshot, error) {
	if p == nil {
		return &SandboxMetricsSnapshot{}, nil
	}

	result, err := p.ListResources(ctx, "")
	if err != nil {
		return nil, err
	}

	resourcesByTypeStatus := make(map[string]map[string]int64)
	for _, resource := range result.Resources {
		if resource == nil {
			continue
		}
		statusCounts := resourcesByTypeStatus[resource.Type]
		if statusCounts == nil {
			statusCounts = make(map[string]int64)
			resourcesByTypeStatus[resource.Type] = statusCounts
		}
		status := resource.Status
		if status == "" {
			status = string(ResourceStatusUnknown)
		}
		statusCounts[status]++
	}

	providerHealthy := make(map[string]int64, len(p.providers))
	now := time.Now()
	if !p.refreshMu.TryLock() {
		return nil, errSnapshotRefreshInProgress
	}
	defer p.refreshMu.Unlock()
	for providerType := range p.providers {
		healthy := int64(1)
		if p.providerFailureCount[providerType] > 0 {
			healthy = 0
		} else if lastSuccess := p.providerLastSuccessAt[providerType]; !lastSuccess.IsZero() &&
			now.Sub(lastSuccess) > 2*p.refreshInterval {
			healthy = 0
		}
		providerHealthy[providerType] = healthy
	}

	return &SandboxMetricsSnapshot{
		ResourcesByTypeStatus: resourcesByTypeStatus,
		ProviderHealthy:       providerHealthy,
	}, nil
}
