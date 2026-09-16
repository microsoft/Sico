package logger

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

type capturedLog struct {
	ctx     context.Context
	level   LogLevel
	message string
	file    string
	line    int
}

type testContextKey struct{}

type captureEmitter struct {
	mu      sync.Mutex
	records []capturedLog
}

func (emitter *captureEmitter) Emit(ctx context.Context, level LogLevel, message, file string, line int) {
	emitter.mu.Lock()
	defer emitter.mu.Unlock()
	emitter.records = append(emitter.records, capturedLog{
		ctx: ctx, level: level, message: message, file: file, line: line,
	})
}

func TestOTLPEmitterCanBeReplacedAndDisabled(t *testing.T) {
	emitter := &captureEmitter{}
	SetOTLPLogEmitter(emitter)
	t.Cleanup(func() { SetOTLPLogEmitter(nil) })

	ctx := context.WithValue(context.Background(), testContextKey{}, "test-value")
	emitOTLPLog(ctx, WARN, "message", "source.go", 42)
	require.Len(t, emitter.records, 1)
	require.Equal(t, WARN, emitter.records[0].level)
	require.Equal(t, "message", emitter.records[0].message)
	require.Equal(t, "source.go", emitter.records[0].file)
	require.Equal(t, 42, emitter.records[0].line)
	require.Equal(t, "test-value", emitter.records[0].ctx.Value(testContextKey{}))

	SetOTLPLogEmitter(nil)
	emitOTLPLog(context.Background(), INFO, "ignored", "source.go", 1)
	require.Len(t, emitter.records, 1)
}

func TestOTLPEmitterConcurrentReplacement(t *testing.T) {
	t.Cleanup(func() { SetOTLPLogEmitter(nil) })
	var waitGroup sync.WaitGroup
	for range 100 {
		waitGroup.Add(2)
		go func() {
			defer waitGroup.Done()
			SetOTLPLogEmitter(&captureEmitter{})
		}()
		go func() {
			defer waitGroup.Done()
			emitOTLPLog(context.Background(), INFO, "concurrent", "source.go", 1)
		}()
	}
	waitGroup.Wait()
}
