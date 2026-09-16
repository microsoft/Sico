package metrics

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"gorm.io/gorm"

	"sico-backend/pkg/logger"
)

var orgProjectStatsOnce sync.Once

type orgProjectStatsState struct {
	mu           sync.RWMutex
	lastOrgCount int64
	lastPrjCount int64
}

func RegisterOrgProjectStats(db *gorm.DB) {
	orgProjectStatsOnce.Do(func() {
		if db == nil {
			logger.Error("organization/project metrics not registered: db is nil")
			return
		}

		meter := otel.Meter("sico-backend/org-project")
		orgGauge, err := meter.Int64ObservableGauge(
			"sico.organization.total",
			metric.WithUnit("{organization}"),
			metric.WithDescription("Total active organizations."),
		)
		if err != nil {
			logger.Error("create gauge sico.organization.total failed: %v", err)
			return
		}
		projectGauge, err := meter.Int64ObservableGauge(
			"sico.project.total",
			metric.WithUnit("{project}"),
			metric.WithDescription("Total active projects."),
		)
		if err != nil {
			logger.Error("create gauge sico.project.total failed: %v", err)
			return
		}

		state := &orgProjectStatsState{}
		_, err = meter.RegisterCallback(
			orgProjectStatsCallback(state, db, orgGauge, projectGauge),
			orgGauge,
			projectGauge,
		)
		if err != nil {
			logger.Error("register organization/project metrics callback failed: %v", err)
		}
	})
}

func orgProjectStatsCallback(
	state *orgProjectStatsState,
	db *gorm.DB,
	orgGauge metric.Int64Observable,
	projectGauge metric.Int64Observable,
) func(context.Context, metric.Observer) error {
	return func(ctx context.Context, observer metric.Observer) error {
		queryCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
		defer cancel()

		orgCount, projectCount, err := queryOrgProjectStats(queryCtx, db)
		if err == nil {
			state.mu.Lock()
			state.lastOrgCount = orgCount
			state.lastPrjCount = projectCount
			state.mu.Unlock()
		} else {
			logger.CtxWarn(ctx, "query organization/project metrics failed: %v", err)
		}

		state.mu.RLock()
		defer state.mu.RUnlock()
		observer.ObserveInt64(orgGauge, state.lastOrgCount)
		observer.ObserveInt64(projectGauge, state.lastPrjCount)
		return nil
	}
}

func queryOrgProjectStats(ctx context.Context, db *gorm.DB) (orgCount, projectCount int64, err error) {
	err = db.WithContext(ctx).
		Raw("SELECT COUNT(*) FROM t_organization WHERE deleted_at IS NULL").
		Scan(&orgCount).Error
	if err != nil {
		return 0, 0, err
	}
	err = db.WithContext(ctx).
		Raw("SELECT COUNT(*) FROM t_project WHERE deleted_at IS NULL").
		Scan(&projectCount).Error
	if err != nil {
		return orgCount, 0, err
	}
	return orgCount, projectCount, nil
}
