package telemetry

import (
	"context"
	"regexp"
	"time"

	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	otellog "go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"

	"sico-backend/pkg/logger"
)

var (
	bearerCredentialPattern = regexp.MustCompile(`(?i)\bbearer\s+[a-z0-9._~+/=-]+`)
	keyedCredentialPattern  = regexp.MustCompile(
		`(?i)\b(authorization|password|secret|token|signature)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)`,
	)
)

const (
	logExportInterval = time.Second
	logExportTimeout  = 3 * time.Second
	logMaxQueueSize   = 2048
	logMaxBatchSize   = 200
)

type otelLogEmitter struct {
	logger otellog.Logger
}

func (emitter *otelLogEmitter) Emit(
	ctx context.Context,
	level logger.LogLevel,
	message, file string,
	line int,
) {
	if emitter == nil || emitter.logger == nil {
		return
	}
	now := time.Now()
	var record otellog.Record
	record.SetTimestamp(now)
	record.SetObservedTimestamp(now)
	record.SetSeverity(logSeverity(level))
	record.SetSeverityText(level.String())
	record.SetBody(otellog.StringValue(redactLogMessage(message)))
	record.AddAttributes(
		otellog.String("code.filepath", file),
		otellog.Int64("code.lineno", int64(line)),
	)
	emitter.logger.Emit(ctx, record)
}

func redactLogMessage(message string) string {
	message = bearerCredentialPattern.ReplaceAllString(message, "Bearer [REDACTED]")
	return keyedCredentialPattern.ReplaceAllString(message, "${1}${2}[REDACTED]")
}

func newLoggerProvider(ctx context.Context, res *resource.Resource) (*sdklog.LoggerProvider, error) {
	endpoint, insecure := signalEndpoint("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT")
	if endpoint == "" {
		logger.SetOTLPLogEmitter(nil)
		return nil, nil
	}

	options := []otlploggrpc.Option{otlploggrpc.WithEndpoint(endpoint)}
	if insecure {
		options = append(options, otlploggrpc.WithInsecure())
	}
	exporter, err := otlploggrpc.New(ctx, options...)
	if err != nil {
		return nil, err
	}
	processor := sdklog.NewBatchProcessor(
		exporter,
		sdklog.WithMaxQueueSize(logMaxQueueSize),
		sdklog.WithExportMaxBatchSize(logMaxBatchSize),
		sdklog.WithExportInterval(logExportInterval),
		sdklog.WithExportTimeout(logExportTimeout),
	)
	provider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(processor),
	)
	logger.SetOTLPLogEmitter(&otelLogEmitter{
		logger: provider.Logger("sico-backend/pkg/logger"),
	})
	return provider, nil
}

func logSeverity(level logger.LogLevel) otellog.Severity {
	switch level {
	case logger.DEBUG:
		return otellog.SeverityDebug
	case logger.INFO:
		return otellog.SeverityInfo
	case logger.WARN:
		return otellog.SeverityWarn
	case logger.ERROR:
		return otellog.SeverityError
	case logger.FATAL:
		return otellog.SeverityFatal
	default:
		return otellog.SeverityUndefined
	}
}
