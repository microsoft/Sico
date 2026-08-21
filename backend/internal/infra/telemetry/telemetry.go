package telemetry

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const defaultMetricExportInterval = 30 * time.Second

type Provider struct {
	tracerProvider *sdktrace.TracerProvider
	meterProvider  *sdkmetric.MeterProvider
}

func NewFromEnvironment(ctx context.Context) (*Provider, error) {
	serviceName := strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME"))
	if serviceName == "" {
		serviceName = "sico-backend"
	}

	res, err := resource.New(
		ctx,
		resource.WithFromEnv(),
		resource.WithHost(),
		resource.WithAttributes(
			semconv.ServiceNameKey.String(serviceName),
			attribute.String("workload", os.Getenv("OTEL_RESOURCE_WORKLOAD")),
			semconv.DeploymentEnvironmentKey.String(os.Getenv("OTEL_RESOURCE_ENVIRONMENT")),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("create OpenTelemetry resource: %w", err)
	}

	samper, err := samplerFromEnvironment()
	if err != nil {
		return nil, err
	}
	tracerProvider, err := newTracerProvider(ctx, res, samper)
	if err != nil {
		return nil, err
	}
	meterProvider, err := newMeterProvider(ctx, res)
	if err != nil {
		_ = tracerProvider.Shutdown(context.Background())
		return nil, err
	}

	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	otel.SetTracerProvider(tracerProvider)
	otel.SetMeterProvider(meterProvider)

	return &Provider{tracerProvider: tracerProvider, meterProvider: meterProvider}, nil
}

func (p *Provider) Shutdown(ctx context.Context) error {
	if p == nil {
		return nil
	}
	var shutdownErrors []error
	if p.meterProvider != nil {
		shutdownErrors = append(shutdownErrors, p.meterProvider.Shutdown(ctx))
	}
	if p.tracerProvider != nil {
		shutdownErrors = append(shutdownErrors, p.tracerProvider.Shutdown(ctx))
	}
	return errors.Join(shutdownErrors...)
}

func newTracerProvider(
	ctx context.Context,
	res *resource.Resource,
	sampler sdktrace.Sampler,
) (*sdktrace.TracerProvider, error) {
	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	}
	endpoint, insecure := signalEndpoint("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if endpoint == "" {
		return sdktrace.NewTracerProvider(options...), nil
	}

	exporterOptions := []otlptracegrpc.Option{otlptracegrpc.WithEndpoint(endpoint)}
	if insecure {
		exporterOptions = append(exporterOptions, otlptracegrpc.WithInsecure())
	}
	exporter, err := otlptracegrpc.New(ctx, exporterOptions...)
	if err != nil {
		return nil, fmt.Errorf("create OTLP trace exporter: %w", err)
	}
	options = append(options, sdktrace.WithBatcher(exporter))
	return sdktrace.NewTracerProvider(options...), nil
}

func newMeterProvider(ctx context.Context, res *resource.Resource) (*sdkmetric.MeterProvider, error) {
	options := []sdkmetric.Option{sdkmetric.WithResource(res)}
	endpoint, insecure := signalEndpoint("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
	if endpoint == "" {
		return sdkmetric.NewMeterProvider(options...), nil
	}

	exporterOptions := []otlpmetricgrpc.Option{otlpmetricgrpc.WithEndpoint(endpoint)}
	if insecure {
		exporterOptions = append(exporterOptions, otlpmetricgrpc.WithInsecure())
	}
	exporter, err := otlpmetricgrpc.New(ctx, exporterOptions...)
	if err != nil {
		return nil, fmt.Errorf("create OTLP metric exporter: %w", err)
	}
	interval, err := metricExportInterval()
	if err != nil {
		return nil, err
	}
	reader := sdkmetric.NewPeriodicReader(exporter, sdkmetric.WithInterval(interval))
	options = append(options, sdkmetric.WithReader(reader))
	return sdkmetric.NewMeterProvider(options...), nil
}

func signalEndpoint(signalEnvironmentVariable string) (string, bool) {
	raw := strings.TrimSpace(os.Getenv(signalEnvironmentVariable))
	if raw == "" {
		raw = strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"))
	}
	if raw == "" {
		return "", false
	}

	insecure := boolEnvironmentVariable(
		strings.Replace(signalEnvironmentVariable, "_ENDPOINT", "_INSECURE", 1),
		boolEnvironmentVariable("OTEL_EXPORTER_OTLP_INSECURE", false),
	)
	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err == nil && parsed.Host != "" {
			if os.Getenv(strings.Replace(signalEnvironmentVariable, "_ENDPOINT", "_INSECURE", 1)) == "" &&
				os.Getenv("OTEL_EXPORTER_OTLP_INSECURE") == "" {
				insecure = parsed.Scheme == "http"
			}
			raw = parsed.Host
		}
	}
	if pathIndex := strings.IndexByte(raw, '/'); pathIndex >= 0 {
		raw = raw[:pathIndex]
	}
	return raw, insecure
}

func samplerFromEnvironment() (sdktrace.Sampler, error) {
	name := strings.ToLower(strings.TrimSpace(os.Getenv("OTEL_TRACES_SAMPLER")))
	argument := strings.TrimSpace(os.Getenv("OTEL_TRACES_SAMPLER_ARG"))
	ratio, err := samplerRatio(argument)
	if err != nil {
		return nil, err
	}
	switch name {
	case "", "parentbased_traceidratio":
		return sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio)), nil
	case "traceidratio":
		return sdktrace.TraceIDRatioBased(ratio), nil
	case "always_on":
		return sdktrace.AlwaysSample(), nil
	case "always_off":
		return sdktrace.NeverSample(), nil
	case "parentbased_always_on":
		return sdktrace.ParentBased(sdktrace.AlwaysSample()), nil
	case "parentbased_always_off":
		return sdktrace.ParentBased(sdktrace.NeverSample()), nil
	default:
		return nil, fmt.Errorf("unsupported OTEL_TRACES_SAMPLER: %q", name)
	}
}

func samplerRatio(raw string) (float64, error) {
	if raw == "" {
		return 1, nil
	}
	ratio, err := strconv.ParseFloat(raw, 64)
	if err != nil || ratio < 0 || ratio > 1 {
		return 0, fmt.Errorf("OTEL_TRACES_SAMPLER_ARG must be a number between 0 and 1")
	}
	return ratio, nil
}

func metricExportInterval() (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv("OTEL_METRIC_EXPORT_INTERVAL"))
	if raw == "" {
		return defaultMetricExportInterval, nil
	}
	if milliseconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if milliseconds <= 0 {
			return 0, fmt.Errorf("OTEL_METRIC_EXPORT_INTERVAL must be greater than zero")
		}
		return time.Duration(milliseconds) * time.Millisecond, nil
	}
	interval, err := time.ParseDuration(raw)
	if err != nil || interval <= 0 {
		return 0, fmt.Errorf("invalid OTEL_METRIC_EXPORT_INTERVAL %q", raw)
	}
	return interval, nil
}

func boolEnvironmentVariable(name string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
