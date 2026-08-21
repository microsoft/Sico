package impl

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-sql-driver/mysql"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"

	taskruntimerepo "sico-backend/internal/store/taskruntime/repository"
)

func TestTranslateErrorPassesThroughNil(t *testing.T) {
	if got := translateError("op", nil); got != nil {
		t.Fatalf("expected nil for nil input, got %v", got)
	}
}

func TestTranslateErrorMapsRecordNotFoundToNotFound(t *testing.T) {
	got := translateError("RpcGetRun", gorm.ErrRecordNotFound)
	st, ok := status.FromError(got)
	if !ok {
		t.Fatalf("translateError did not return a status error: %v", got)
	}
	if st.Code() != codes.NotFound {
		t.Fatalf("expected NotFound, got %s", st.Code())
	}
}

func TestTranslateErrorMapsStaleTokenToFailedPrecondition(t *testing.T) {
	// Errors that wrap the stale-token sentinel via fmt.Errorf("%w: ...") must
	// still be detected after crossing the repository boundary.
	wrapped := fmt.Errorf("%w: run abc", taskruntimerepo.ErrStaleToken)
	got := translateError("RpcHeartbeatBatch", wrapped)
	st, ok := status.FromError(got)
	if !ok {
		t.Fatalf("translateError did not return a status error: %v", got)
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %s", st.Code())
	}
}

func TestTranslateErrorMapsDuplicateSentinelToAlreadyExists(t *testing.T) {
	got := translateError("RpcCreateRun", taskruntimerepo.ErrDuplicate)
	st, ok := status.FromError(got)
	if !ok {
		t.Fatalf("translateError did not return a status error: %v", got)
	}
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %s", st.Code())
	}
}

func TestTranslateErrorMapsRawMySQLDuplicateToAlreadyExists(t *testing.T) {
	// A raw driver duplicate (e.g. from a unique-constraint update that never
	// went through the create path) must still map to AlreadyExists.
	inner := &mysql.MySQLError{Number: 1062, Message: "Duplicate entry"}
	wrapped := fmt.Errorf("create: %w", inner)
	got := translateError("RpcCreateRun", wrapped)
	st, _ := status.FromError(got)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists for wrapped duplicate, got %s", st.Code())
	}
}

func TestTranslateErrorDefaultIsInternal(t *testing.T) {
	got := translateError("RpcCreateRun", errors.New("kaboom"))
	st, _ := status.FromError(got)
	if st.Code() != codes.Internal {
		t.Fatalf("expected Internal, got %s", st.Code())
	}
}
