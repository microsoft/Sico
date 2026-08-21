package impl

import (
	"errors"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"

	taskruntimerepo "sico-backend/internal/store/taskruntime/repository"
)

// duplicateKeyToken is the stable substring legacy Python clients fall back to
// when classifying AlreadyExists responses; it must stay in the error message.
const duplicateKeyToken = "duplicate key"

// responseSuccess is the Msg field every successful reverse-RPC response carries.
const responseSuccess = "success"

// internalError wraps a transport/DB-level failure as a gRPC Internal error.
// It is intentionally opaque about the underlying error structure: leaking
// gorm error types across the wire would be a coupling smell.
func internalError(op string, err error) error {
	return status.Errorf(codes.Internal, "%s: %s", op, err.Error())
}

// translateError maps repository errors to gRPC status errors with appropriate
// codes. This is the single chokepoint between the persistence layer and the
// wire: record-not-found becomes NotFound, a stale fencing token becomes
// FailedPrecondition, and a unique-constraint collision becomes AlreadyExists
// (which Python clients translate into a re-read via lookup_idempotent).
func translateError(op string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return status.Error(codes.NotFound, fmt.Sprintf("%s: %s", op, err.Error()))
	}
	if errors.Is(err, taskruntimerepo.ErrStaleToken) {
		return status.Error(codes.FailedPrecondition, fmt.Sprintf("%s: %s", op, err.Error()))
	}
	if errors.Is(err, taskruntimerepo.ErrDuplicate) || taskruntimerepo.IsDuplicateKey(err) {
		return status.Error(codes.AlreadyExists, fmt.Sprintf("%s: %s: %s", op, duplicateKeyToken, err.Error()))
	}
	return internalError(op, err)
}
