package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestSignalEndpoint(t *testing.T) {
	tests := []struct {
		name           string
		signalEndpoint string
		globalEndpoint string
		signalInsecure string
		globalInsecure string
		wantEndpoint   string
		wantInsecure   bool
	}{
		{name: "disabled when unset"},
		{
			name:           "uses signal endpoint before global endpoint",
			signalEndpoint: "metrics-collector:4317",
			globalEndpoint: "global-collector:4317",
			wantEndpoint:   "metrics-collector:4317",
		},
		{
			name:           "falls back to global endpoint",
			globalEndpoint: "global-collector:4317",
			globalInsecure: "true",
			wantEndpoint:   "global-collector:4317",
			wantInsecure:   true,
		},
		{
			name:           "normalizes HTTP URL and infers insecure",
			signalEndpoint: "http://collector:4317/v1/metrics",
			wantEndpoint:   "collector:4317",
			wantInsecure:   true,
		},
		{
			name:           "normalizes HTTPS URL",
			signalEndpoint: "https://collector.example/v1/metrics",
			wantEndpoint:   "collector.example",
		},
		{
			name:           "signal insecure overrides URL inference",
			signalEndpoint: "https://collector.example/v1/metrics",
			signalInsecure: "true",
			wantEndpoint:   "collector.example",
			wantInsecure:   true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", test.signalEndpoint)
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", test.globalEndpoint)
			t.Setenv("OTEL_EXPORTER_OTLP_METRICS_INSECURE", test.signalInsecure)
			t.Setenv("OTEL_EXPORTER_OTLP_INSECURE", test.globalInsecure)

			endpoint, insecure := signalEndpoint("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")
			if endpoint != test.wantEndpoint {
				t.Fatalf("signalEndpoint() endpoint = %q, want %q", endpoint, test.wantEndpoint)
			}
			if insecure != test.wantInsecure {
				t.Fatalf("signalEndpoint() insecure = %t, want %t", insecure, test.wantInsecure)
			}
		})
	}
}

func TestLogsSignalEndpointFallback(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4317/v1/logs")
	t.Setenv("OTEL_EXPORTER_OTLP_LOGS_INSECURE", "")
	t.Setenv("OTEL_EXPORTER_OTLP_INSECURE", "")

	endpoint, insecure := signalEndpoint("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT")
	require.Equal(t, "collector:4317", endpoint)
	require.True(t, insecure)
}

func TestMetricExportInterval(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    time.Duration
		wantErr bool
	}{
		{name: "default", want: defaultMetricExportInterval},
		{name: "milliseconds", value: "1500", want: 1500 * time.Millisecond},
		{name: "duration", value: "45s", want: 45 * time.Second},
		{name: "zero", value: "0", wantErr: true},
		{name: "negative duration", value: "-1s", wantErr: true},
		{name: "invalid", value: "later", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", test.value)

			interval, err := metricExportInterval()
			if test.wantErr {
				if err == nil {
					t.Fatal("metricExportInterval() error = nil, want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("metricExportInterval() error = %v", err)
			}
			if interval != test.want {
				t.Fatalf("metricExportInterval() = %s, want %s", interval, test.want)
			}
		})
	}
}

func TestSamplerFromEnvironment(t *testing.T) {
	tests := []struct {
		name         string
		sampler      string
		argument     string
		wantDecision sdktrace.SamplingDecision
		wantErr      bool
	}{
		{name: "default", argument: "0", wantDecision: sdktrace.Drop},
		{name: "always on", sampler: "always_on", wantDecision: sdktrace.RecordAndSample},
		{name: "always off", sampler: "always_off", wantDecision: sdktrace.Drop},
		{name: "ratio zero", sampler: "traceidratio", argument: "0", wantDecision: sdktrace.Drop},
		{name: "unsupported", sampler: "custom", wantErr: true},
		{name: "invalid ratio", sampler: "traceidratio", argument: "1.1", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("OTEL_TRACES_SAMPLER", test.sampler)
			t.Setenv("OTEL_TRACES_SAMPLER_ARG", test.argument)

			sampler, err := samplerFromEnvironment()
			if test.wantErr {
				if err == nil {
					t.Fatal("samplerFromEnvironment() error = nil, want an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("samplerFromEnvironment() error = %v", err)
			}
			result := sampler.ShouldSample(sdktrace.SamplingParameters{})
			if result.Decision != test.wantDecision {
				t.Fatalf("sampler decision = %v, want %v", result.Decision, test.wantDecision)
			}
		})
	}
}

func TestProviderShutdown(t *testing.T) {
	var nilProvider *Provider
	if err := nilProvider.Shutdown(context.Background()); err != nil {
		t.Fatalf("nil Provider.Shutdown() error = %v", err)
	}

	provider := &Provider{
		tracerProvider: sdktrace.NewTracerProvider(),
		meterProvider:  sdkmetric.NewMeterProvider(),
	}
	if err := provider.Shutdown(context.Background()); err != nil {
		t.Fatalf("Provider.Shutdown() error = %v", err)
	}
}
