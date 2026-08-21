package safego

import (
	"context"
	"runtime/debug"

	"sico-backend/pkg/logger"
)

// PanicHandler is invoked when a goroutine started by this package recovers
// from a panic. It receives the recovered value and the captured stack trace.
// Handlers must not panic.
type PanicHandler func(ctx context.Context, recovered any, stack []byte)

// Recover recovers from a panic in the current goroutine, logs it with the
// given context, and invokes optional handlers. It is intended to be used via
// `defer Recover(ctx, handlers...)`.
func Recover(ctx context.Context, handlers ...PanicHandler) {
	r := recover()
	if r == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	stack := debug.Stack()
	logger.GetLogger().CtxError(ctx, "[safego] recovered from panic: %v\nstack:\n%s", r, stack)
	for _, h := range handlers {
		if h == nil {
			continue
		}
		func() {
			defer func() {
				if hp := recover(); hp != nil {
					logger.GetLogger().CtxError(ctx, "[safego] panic handler itself panicked: %v", hp)
				}
			}()
			h(ctx, r, stack)
		}()
	}
}

// Go launches fn in a new goroutine, recovering from any panic and logging it
// with the provided context.
func Go(ctx context.Context, fn func()) {
	go func() {
		defer Recover(ctx)
		fn()
	}()
}

// GoWithRecover launches fn in a new goroutine. If fn panics, the recovery is
// logged and the provided handlers are invoked in order. Useful for surfacing
// panics to callers (e.g. via an error channel) without losing the default
// logging behavior.
func GoWithRecover(ctx context.Context, fn func(), handlers ...PanicHandler) {
	go func() {
		defer Recover(ctx, handlers...)
		fn()
	}()
}
