package telemetry

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/trace"

	"sico-backend/pkg/logger"
)

type captureLogExporter struct {
	mu      sync.Mutex
	records []sdklog.Record
}

func (exporter *captureLogExporter) Export(_ context.Context, records []sdklog.Record) error {
	exporter.mu.Lock()
	defer exporter.mu.Unlock()
	for index := range records {
		exporter.records = append(exporter.records, records[index].Clone())
	}
	return nil
}

func (*captureLogExporter) Shutdown(context.Context) error   { return nil }
func (*captureLogExporter) ForceFlush(context.Context) error { return nil }

func (exporter *captureLogExporter) snapshot() []sdklog.Record {
	exporter.mu.Lock()
	defer exporter.mu.Unlock()
	return append([]sdklog.Record(nil), exporter.records...)
}

func TestOTelLogEmitterMapsRecordAndTraceContext(t *testing.T) {
	exporter := &captureLogExporter{}
	provider := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewSimpleProcessor(exporter)))
	t.Cleanup(func() { require.NoError(t, provider.Shutdown(context.Background())) })
	emitter := &otelLogEmitter{logger: provider.Logger("test")}
	traceID := trace.TraceID{1, 2, 3}
	spanID := trace.SpanID{4, 5, 6}
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID,
		SpanID:  spanID,
		Remote:  true,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), spanContext)

	emitter.Emit(ctx, logger.ERROR, "first line\nsecond line", "source.go", 42)

	records := exporter.snapshot()
	require.Len(t, records, 1)
	require.Equal(t, otellog.SeverityError, records[0].Severity())
	require.Equal(t, "ERROR", records[0].SeverityText())
	require.Equal(t, "first line\nsecond line", records[0].Body().AsString())
	require.Equal(t, traceID, records[0].TraceID())
	require.Equal(t, spanID, records[0].SpanID())
	attributes := logRecordAttributes(records[0])
	require.Equal(t, "source.go", attributes["code.filepath"].AsString())
	require.Equal(t, int64(42), attributes["code.lineno"].AsInt64())
}

func TestBatchLogProviderFlushesOnShutdown(t *testing.T) {
	exporter := &captureLogExporter{}
	processor := sdklog.NewBatchProcessor(
		exporter,
		sdklog.WithExportInterval(time.Hour),
		sdklog.WithMaxQueueSize(8),
	)
	provider := sdklog.NewLoggerProvider(sdklog.WithProcessor(processor))
	emitter := &otelLogEmitter{logger: provider.Logger("test")}
	emitter.Emit(context.Background(), logger.INFO, "pending", "source.go", 1)

	require.NoError(t, provider.Shutdown(context.Background()))
	require.Len(t, exporter.snapshot(), 1)
}

func TestProviderShutdownDetachesLogEmitter(t *testing.T) {
	exporter := &captureLogExporter{}
	loggerProvider := sdklog.NewLoggerProvider(sdklog.WithProcessor(sdklog.NewSimpleProcessor(exporter)))
	logger.SetOTLPLogEmitter(&otelLogEmitter{logger: loggerProvider.Logger("test")})
	t.Cleanup(func() { logger.SetOTLPLogEmitter(nil) })
	provider := &Provider{loggerProvider: loggerProvider}

	logger.Info("before shutdown")
	require.NoError(t, provider.Shutdown(context.Background()))
	logger.Info("after shutdown")

	require.Len(t, exporter.snapshot(), 1)
}

type blockingLogExporter struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (exporter *blockingLogExporter) Export(ctx context.Context, _ []sdklog.Record) error {
	exporter.once.Do(func() { close(exporter.started) })
	select {
	case <-exporter.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (*blockingLogExporter) Shutdown(context.Context) error   { return nil }
func (*blockingLogExporter) ForceFlush(context.Context) error { return nil }

func TestBatchLogProviderDoesNotBlockWhenQueueIsFull(t *testing.T) {
	exporter := &blockingLogExporter{started: make(chan struct{}), release: make(chan struct{})}
	processor := sdklog.NewBatchProcessor(
		exporter,
		sdklog.WithExportMaxBatchSize(1),
		sdklog.WithMaxQueueSize(1),
		sdklog.WithExportInterval(time.Millisecond),
	)
	provider := sdklog.NewLoggerProvider(sdklog.WithProcessor(processor))
	emitter := &otelLogEmitter{logger: provider.Logger("test")}
	emitter.Emit(context.Background(), logger.INFO, "first", "source.go", 1)
	select {
	case <-exporter.started:
	case <-time.After(time.Second):
		t.Fatal("batch exporter did not start")
	}

	done := make(chan struct{})
	go func() {
		emitter.Emit(context.Background(), logger.INFO, "second", "source.go", 2)
		emitter.Emit(context.Background(), logger.INFO, "dropped", "source.go", 3)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("log emit blocked on a full queue")
	}
	close(exporter.release)
	require.NoError(t, provider.Shutdown(context.Background()))
}

func TestLogSeverity(t *testing.T) {
	require.Equal(t, otellog.SeverityDebug, logSeverity(logger.DEBUG))
	require.Equal(t, otellog.SeverityInfo, logSeverity(logger.INFO))
	require.Equal(t, otellog.SeverityWarn, logSeverity(logger.WARN))
	require.Equal(t, otellog.SeverityError, logSeverity(logger.ERROR))
	require.Equal(t, otellog.SeverityFatal, logSeverity(logger.FATAL))
}

func TestRedactLogMessage(t *testing.T) {
	message := `authorization=Bearer abc.def password: "hunter2" token=abc123 signature=signed secret=value safe=visible`
	redacted := redactLogMessage(message)
	require.NotContains(t, redacted, "abc.def")
	require.NotContains(t, redacted, "hunter2")
	require.NotContains(t, redacted, "abc123")
	require.NotContains(t, redacted, "signed")
	require.NotContains(t, redacted, "secret=value")
	require.Contains(t, redacted, "safe=visible")
}

func logRecordAttributes(record sdklog.Record) map[string]otellog.Value {
	attributes := make(map[string]otellog.Value)
	record.WalkAttributes(func(value otellog.KeyValue) bool {
		attributes[value.Key] = value.Value
		return true
	})
	return attributes
}
