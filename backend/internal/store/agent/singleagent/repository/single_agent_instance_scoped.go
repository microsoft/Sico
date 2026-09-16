package repository

import (
	"context"
	"fmt"

	entity "sico-backend/internal/entity/agent/singleagent"
)

func (w *otelTracedSingleAgentInstanceRepository) ListByFilterInProjects(
	ctx context.Context,
	filter *entity.ListSingleAgentInstanceFilter,
	projectIDs []int64,
	offset, limit int,
) ([]*entity.SingleAgentInstance, int64, error) {
	scoped, ok := w.next.(OrganizationScopedSingleAgentInstanceRepository)
	if !ok {
		return nil, 0, fmt.Errorf("agent instance repository does not support organization scoping")
	}
	return scoped.ListByFilterInProjects(ctx, filter, projectIDs, offset, limit)
}
