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

const (
	taskStatusCompleted = "completed"
	taskStatusFailed    = "failed"
	taskStatusCancelled = "cancelled"
	taskStatusTimedOut  = "timed_out"
	taskStatusBlocked   = "blocked"
)

var taskRuntimeStatsOnce sync.Once

var terminalRunStatuses = map[string]bool{
	taskStatusCompleted: true,
	taskStatusFailed:    true,
	taskStatusCancelled: true,
	taskStatusTimedOut:  true,
	taskStatusBlocked:   true,
}

type statusCount struct {
	Status string
	Count  int64
}

type taskRuntimeStatsState struct {
	mu              sync.RWMutex
	lastRuns        []statusCount
	lastBatches     []statusCount
	lastSuccessRate float64
}

func RegisterTaskRuntimeStats(db *gorm.DB) {
	taskRuntimeStatsOnce.Do(func() {
		if db == nil {
			logger.Error("task runtime metrics not registered: db is nil")
			return
		}

		meter := otel.Meter("sico-backend/task-runtime")
		runsGauge, err := meter.Int64ObservableGauge(
			"sico.task_runtime.runs_total",
			metric.WithUnit("{run}"),
			metric.WithDescription("Total task runtime runs grouped by status."),
		)
		if err != nil {
			logger.Error("create gauge sico.task_runtime.runs_total failed: %v", err)
			return
		}
		batchesGauge, err := meter.Int64ObservableGauge(
			"sico.task_runtime.batches_total",
			metric.WithUnit("{batch}"),
			metric.WithDescription("Total task runtime batches grouped by status."),
		)
		if err != nil {
			logger.Error("create gauge sico.task_runtime.batches_total failed: %v", err)
			return
		}
		successRateGauge, err := meter.Float64ObservableGauge(
			"sico.task_runtime.run_success_rate",
			metric.WithUnit("1"),
			metric.WithDescription("Completed runs divided by terminal runs."),
		)
		if err != nil {
			logger.Error("create gauge sico.task_runtime.run_success_rate failed: %v", err)
			return
		}

		state := &taskRuntimeStatsState{}
		_, err = meter.RegisterCallback(func(ctx context.Context, observer metric.Observer) error {
			queryCtx, cancel := context.WithTimeout(ctx, 800*time.Millisecond)
			defer cancel()
			runs, batches, queryErr := queryTaskRuntimeStats(queryCtx, db)
			if queryErr == nil {
				state.mu.Lock()
				state.lastRuns = runs
				state.lastBatches = batches
				state.lastSuccessRate = computeTaskSuccessRate(runs)
				state.mu.Unlock()
			} else {
				logger.CtxWarn(ctx, "query task runtime metrics failed: %v", queryErr)
			}

			state.mu.RLock()
			defer state.mu.RUnlock()
			for _, run := range state.lastRuns {
				observer.ObserveInt64(
					runsGauge,
					run.Count,
					metric.WithAttributes(attribute.String("status", run.Status)),
				)
			}
			for _, batch := range state.lastBatches {
				observer.ObserveInt64(
					batchesGauge,
					batch.Count,
					metric.WithAttributes(attribute.String("status", batch.Status)),
				)
			}
			observer.ObserveFloat64(successRateGauge, state.lastSuccessRate)
			return nil
		}, runsGauge, batchesGauge, successRateGauge)
		if err != nil {
			logger.Error("register task runtime metrics callback failed: %v", err)
		}
	})
}

func computeTaskSuccessRate(runs []statusCount) float64 {
	var completed, terminal int64
	for _, run := range runs {
		if terminalRunStatuses[run.Status] {
			terminal += run.Count
		}
		if run.Status == taskStatusCompleted {
			completed = run.Count
		}
	}
	if terminal == 0 {
		return 0
	}
	return float64(completed) / float64(terminal)
}

func queryTaskRuntimeStats(ctx context.Context, db *gorm.DB) ([]statusCount, []statusCount, error) {
	var runs []statusCount
	err := db.WithContext(ctx).
		Raw("SELECT status, COUNT(*) AS count FROM t_task_runtime_run GROUP BY status").
		Scan(&runs).Error
	if err != nil {
		return nil, nil, err
	}
	var batches []statusCount
	err = db.WithContext(ctx).
		Raw("SELECT status, COUNT(*) AS count FROM t_task_runtime_batch GROUP BY status").
		Scan(&batches).Error
	if err != nil {
		return runs, nil, err
	}
	return runs, batches, nil
}
