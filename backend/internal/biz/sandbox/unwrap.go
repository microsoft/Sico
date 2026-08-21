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
		wrapper, ok := svc.(interface{ Unwrap() Service })
		if !ok {
			return nil, false
		}
		svc = wrapper.Unwrap()
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
