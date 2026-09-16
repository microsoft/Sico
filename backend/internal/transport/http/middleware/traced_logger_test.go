package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"sico-backend/pkg/logger"
)

type capturedAccessLog struct {
	message     string
	spanContext trace.SpanContext
}

type accessLogEmitter struct {
	mu      sync.Mutex
	records []capturedAccessLog
}

func (emitter *accessLogEmitter) Emit(
	ctx context.Context,
	_ logger.LogLevel,
	message, _ string,
	_ int,
) {
	emitter.mu.Lock()
	defer emitter.mu.Unlock()
	emitter.records = append(emitter.records, capturedAccessLog{
		message:     message,
		spanContext: trace.SpanContextFromContext(ctx),
	})
}

func TestTracedLoggerUsesRouteAndTraceWithoutQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tracerProvider := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.AlwaysSample()))
	previousTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(tracerProvider)
	t.Cleanup(func() {
		otel.SetTracerProvider(previousTracerProvider)
		require.NoError(t, tracerProvider.Shutdown(context.Background()))
	})
	emitter := &accessLogEmitter{}
	logger.SetOTLPLogEmitter(emitter)
	t.Cleanup(func() { logger.SetOTLPLogEmitter(nil) })

	router := gin.New()
	router.Use(otelgin.Middleware("test-service"))
	router.Use(TracedLogger())
	router.GET("/items/:id", func(ctx *gin.Context) { ctx.Status(http.StatusNoContent) })
	request := httptest.NewRequest(http.MethodGet, "/items/42?token=top-secret", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusNoContent, response.Code)
	require.Len(t, emitter.records, 1)
	require.True(t, emitter.records[0].spanContext.IsValid())
	require.Contains(t, emitter.records[0].message, "route=/items/:id")
	require.Contains(t, emitter.records[0].message, "status=204")
	require.False(t, strings.Contains(emitter.records[0].message, "top-secret"))
	require.False(t, strings.Contains(emitter.records[0].message, "?token="))
}
