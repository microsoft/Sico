package logger

import (
	"context"
	"sync/atomic"
)

type OTLPLogEmitter interface {
	Emit(ctx context.Context, level LogLevel, message, file string, line int)
}

type noopOTLPLogEmitter struct{}

func (noopOTLPLogEmitter) Emit(context.Context, LogLevel, string, string, int) {}

type otlpEmitterHolder struct {
	emitter OTLPLogEmitter
}

var otlpEmitter atomic.Value

func init() {
	otlpEmitter.Store(&otlpEmitterHolder{emitter: noopOTLPLogEmitter{}})
}

func SetOTLPLogEmitter(emitter OTLPLogEmitter) {
	if emitter == nil {
		emitter = noopOTLPLogEmitter{}
	}
	otlpEmitter.Store(&otlpEmitterHolder{emitter: emitter})
}

func emitOTLPLog(ctx context.Context, level LogLevel, message, file string, line int) {
	if ctx == nil {
		ctx = context.Background()
	}
	holder := otlpEmitter.Load().(*otlpEmitterHolder)
	holder.emitter.Emit(ctx, level, message, file, line)
}
