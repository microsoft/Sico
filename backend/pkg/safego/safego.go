// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

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
