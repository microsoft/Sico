package metrics

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"sico-backend/pkg/logger"
)

var taskRuntimeCountersOnce sync.Once

var (
	taskRunsCreatedCounter     metric.Int64Counter
	taskRunsTerminalCounter    metric.Int64Counter
	taskBatchesCreatedCounter  metric.Int64Counter
	taskBatchesTerminalCounter metric.Int64Counter
	taskRunDurationHistogram   metric.Int64Histogram
	taskBatchDurationHistogram metric.Int64Histogram
)

var terminalBatchStatuses = map[string]bool{
	"completed": true,
	"partial":   true,
	"failed":    true,
	"cancelled": true,
	"timed_out": true,
}

func InitTaskRuntimeCounters() {
	taskRuntimeCountersOnce.Do(func() {
		meter := otel.Meter("sico-backend/task-runtime")
		var err error
		taskRunsCreatedCounter, err = meter.Int64Counter(
			"sico.task_runtime.runs_created",
			metric.WithUnit("{run}"),
			metric.WithDescription("Successful task runtime run create calls."),
		)
		if err != nil {
			logger.Error("create counter sico.task_runtime.runs_created failed: %v", err)
		}
		taskRunsTerminalCounter, err = meter.Int64Counter(
			"sico.task_runtime.runs_terminal",
			metric.WithUnit("{run}"),
			metric.WithDescription("Successful calls reporting a terminal run status."),
		)
		if err != nil {
			logger.Error("create counter sico.task_runtime.runs_terminal failed: %v", err)
		}
		taskBatchesCreatedCounter, err = meter.Int64Counter(
			"sico.task_runtime.batches_created",
			metric.WithUnit("{batch}"),
			metric.WithDescription("Successful task runtime batch create calls."),
		)
		if err != nil {
			logger.Error("create counter sico.task_runtime.batches_created failed: %v", err)
		}
		taskBatchesTerminalCounter, err = meter.Int64Counter(
			"sico.task_runtime.batches_terminal",
			metric.WithUnit("{batch}"),
			metric.WithDescription("Successful calls reporting a terminal batch status."),
		)
		if err != nil {
			logger.Error("create counter sico.task_runtime.batches_terminal failed: %v", err)
		}
		taskRunDurationHistogram, err = meter.Int64Histogram(
			"sico.task_runtime.run_duration_ms",
			metric.WithUnit("ms"),
			metric.WithDescription("Queued-to-ended duration reported for terminal runs."),
		)
		if err != nil {
			logger.Error("create histogram sico.task_runtime.run_duration_ms failed: %v", err)
		}
		taskBatchDurationHistogram, err = meter.Int64Histogram(
			"sico.task_runtime.batch_duration_ms",
			metric.WithUnit("ms"),
			metric.WithDescription("Created-to-ended duration for terminal batches."),
		)
		if err != nil {
			logger.Error("create histogram sico.task_runtime.batch_duration_ms failed: %v", err)
		}
	})
}

func RecordRunCreated(ctx context.Context, executor string) {
	if taskRunsCreatedCounter == nil {
		return
	}
	taskRunsCreatedCounter.Add(ctx, 1, metric.WithAttributes(executorAttribute(executor)...))
}

func RecordRunTerminal(ctx context.Context, status, executor string, durationMS int64, hasDuration bool) {
	if taskRunsTerminalCounter == nil || !terminalRunStatuses[status] {
		return
	}
	attributes := append([]attribute.KeyValue{attribute.String("status", status)}, executorAttribute(executor)...)
	taskRunsTerminalCounter.Add(ctx, 1, metric.WithAttributes(attributes...))
	if taskRunDurationHistogram != nil && hasDuration && durationMS > 0 {
		taskRunDurationHistogram.Record(ctx, durationMS, metric.WithAttributes(attributes...))
	}
}

func RecordBatchCreated(ctx context.Context) {
	if taskBatchesCreatedCounter != nil {
		taskBatchesCreatedCounter.Add(ctx, 1)
	}
}

func RecordBatchTerminal(ctx context.Context, status string, durationMS int64, hasDuration bool) {
	if taskBatchesTerminalCounter == nil || !terminalBatchStatuses[status] {
		return
	}
	attributes := []attribute.KeyValue{attribute.String("status", status)}
	taskBatchesTerminalCounter.Add(ctx, 1, metric.WithAttributes(attributes...))
	if taskBatchDurationHistogram != nil && hasDuration && durationMS > 0 {
		taskBatchDurationHistogram.Record(ctx, durationMS, metric.WithAttributes(attributes...))
	}
}

func executorAttribute(executor string) []attribute.KeyValue {
	if executor == "" {
		return nil
	}
	return []attribute.KeyValue{attribute.String("executor", executor)}
}
