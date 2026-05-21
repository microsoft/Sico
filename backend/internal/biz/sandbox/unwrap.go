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

package sandbox

import (
	"context"

	"sico-backend/internal/biz/sandbox/impl"
)

// DefaultImplService returns the underlying impl.Service, unwrapping tracing wrappers if needed.
func DefaultImplService() (*impl.Service, bool) {
	return unwrapImplService(defaultSvc)
}

func unwrapImplService(svc Service) (*impl.Service, bool) {
	for svc != nil {
		if implSvc, ok := svc.(*impl.Service); ok {
			return implSvc, true
		}
	}

	return nil, false
}

// WithInstanceAssignmentLock serializes sandbox assignment operations for a single instance.
func WithInstanceAssignmentLock(ctx context.Context, instanceID string, fn func() error) error {
	implSvc, ok := DefaultImplService()
	if !ok || implSvc == nil {
		if fn == nil {
			return nil
		}
		return fn()
	}

	return implSvc.WithInstanceAssignmentLock(ctx, instanceID, fn)
}

// HasAssignedSandboxesStrict checks whether an instance still has sandbox bindings.
// Unlike dashboard read paths, this helper fails closed on lease read errors.
func HasAssignedSandboxesStrict(ctx context.Context, instanceID string) (bool, int, error) {
	implSvc, ok := DefaultImplService()
	if !ok || implSvc == nil {
		return false, 0, nil
	}

	return implSvc.HasAssignedSandboxesStrict(ctx, instanceID)
}
