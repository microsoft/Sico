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

package sse

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"

	"sico-backend/pkg/logger"
	"sico-backend/pkg/safego"
)

var sseDataReplacer = strings.NewReplacer(
	"\n", "\ndata:",
	"\r", "\\r",
)

type GinSSESender struct {
	done bool
	// writer is the underlying http.ResponseWriter extracted at construction time.
	// We write SSE frames directly to it instead of going through gin's c.Render()
	// pipeline, which mutates trailer headers and swallows write errors.
	writer http.ResponseWriter
	rc     *http.ResponseController
	mu     sync.Mutex
}

func NewGinSSESender(c *gin.Context) SSESender {
	w := c.Writer

	// set headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	w.Flush()

	ret := &GinSSESender{
		done:   false,
		writer: w,
		rc:     http.NewResponseController(w),
	}

	safego.Go(c.Request.Context(), func() {
		closeChannel := w.CloseNotify()
		<-closeChannel
		ret.NotifyClosed()
	})

	return ret
}

// writeSSEEvent writes an SSE-formatted event directly to the writer,
// bypassing gin's c.Render()/c.SSEvent() pipeline which modifies context
// state (trailer headers, c.Abort) and silently swallows write errors.
func writeSSEEvent(w http.ResponseWriter, event *Event) error {
	if len(event.Event) > 0 {
		if _, err := fmt.Fprintf(w, "event:%s\n", event.Event); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(w, "data:"); err != nil {
		return err
	}
	if _, err := sseDataReplacer.WriteString(w, string(event.Data)); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "\n\n"); err != nil {
		return err
	}
	return nil
}

func (s *GinSSESender) Send(ctx context.Context, event *Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if connection is closed before attempting to send
	if s.done {
		logger.CtxWarn(ctx, "sse_send_skipped_closed_connection event=%s payload_len=%d", event.Event, len(event.Data))
		return errors.Join(context.Canceled, fmt.Errorf("SSE connection is closed"))
	}

	// Write SSE event directly to the response writer
	if err := writeSSEEvent(s.writer, event); err != nil {
		s.done = true
		return errors.Join(context.Canceled, fmt.Errorf("SSE write failed: %w", err))
	}

	// Use ResponseController.Flush to capture flush errors
	if err := s.rc.Flush(); err != nil {
		s.done = true
		return errors.Join(context.Canceled, fmt.Errorf("SSE flush failed: %w", err))
	}

	return nil
}

func (s *GinSSESender) NotifyClosed() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.done = true
}

func (s *GinSSESender) Done() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.done
}
