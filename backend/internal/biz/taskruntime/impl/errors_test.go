// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package impl

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-sql-driver/mysql"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
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
	// Errors that wrap errStaleToken via fmt.Errorf("%w: ...") must still be detected.
	wrapped := fmt.Errorf("%w: run abc", errStaleToken)
	got := translateError("RpcHeartbeatBatch", wrapped)
	st, ok := status.FromError(got)
	if !ok {
		t.Fatalf("translateError did not return a status error: %v", got)
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition, got %s", st.Code())
	}
	if !errors.Is(wrapped, errStaleToken) {
		t.Fatalf("sanity: wrapped error should still match errStaleToken")
	}
}

func TestTranslateErrorMapsMySQLDuplicateKeyToAlreadyExists(t *testing.T) {
	got := translateError("RpcCreateRun", &mysql.MySQLError{Number: mysqlDuplicateErrNum, Message: "Duplicate entry"})
	st, ok := status.FromError(got)
	if !ok {
		t.Fatalf("translateError did not return a status error: %v", got)
	}
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got %s", st.Code())
	}
}

func TestTranslateErrorMapsWrappedDuplicateKey(t *testing.T) {
	// gorm typically wraps the raw driver error; ensure the unwrap path works.
	inner := &mysql.MySQLError{Number: mysqlDuplicateErrNum, Message: "Duplicate entry"}
	wrapped := fmt.Errorf("create: %w", inner)
	got := translateError("RpcCreateRun", wrapped)
	st, _ := status.FromError(got)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists for wrapped duplicate, got %s", st.Code())
	}
}

func TestTranslateErrorDuplicateKeyFallsBackOnMessage(t *testing.T) {
	// Some test doubles surface a plain error with the duplicate-entry message
	// but no underlying mysql.MySQLError. The string-fallback must still catch it.
	got := translateError("RpcCreateRun", errors.New("Error 1062 (23000): Duplicate entry 'x' for key 'uniq'"))
	st, _ := status.FromError(got)
	if st.Code() != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists from message fallback, got %s", st.Code())
	}
}

func TestTranslateErrorDefaultIsInternal(t *testing.T) {
	got := translateError("RpcCreateRun", errors.New("kaboom"))
	st, _ := status.FromError(got)
	if st.Code() != codes.Internal {
		t.Fatalf("expected Internal, got %s", st.Code())
	}
}

func TestIsStaleTokenIdentifiesWrappedErrors(t *testing.T) {
	if IsStaleToken(nil) {
		t.Fatal("nil should not be a stale token")
	}
	if IsStaleToken(errors.New("other")) {
		t.Fatal("unrelated error should not be a stale token")
	}
	if !IsStaleToken(fmt.Errorf("ctx: %w", errStaleToken)) {
		t.Fatal("wrapped errStaleToken should be detected")
	}
}

func TestIsDuplicateKeyHandlesDirectAndWrapped(t *testing.T) {
	direct := &mysql.MySQLError{Number: mysqlDuplicateErrNum}
	if !isDuplicateKey(direct) {
		t.Fatal("direct MySQLError 1062 should be a duplicate key")
	}
	wrapped := fmt.Errorf("create: %w", direct)
	if !isDuplicateKey(wrapped) {
		t.Fatal("wrapped MySQLError 1062 should be a duplicate key")
	}
	other := &mysql.MySQLError{Number: 1234}
	if isDuplicateKey(other) {
		t.Fatal("MySQLError with unrelated number should not be a duplicate key")
	}
	if isDuplicateKey(errors.New("unrelated")) {
		t.Fatal("unrelated error should not be a duplicate key")
	}
}

func TestIsRetryableTransactionErrorHandlesMySQLDeadlocks(t *testing.T) {
	if !isRetryableTransactionError(&mysql.MySQLError{Number: mysqlDeadlockErrNum}) {
		t.Fatal("MySQLError 1213 should be retryable")
	}
	if !isRetryableTransactionError(&mysql.MySQLError{Number: mysqlLockWaitErrNum}) {
		t.Fatal("MySQLError 1205 should be retryable")
	}
	wrapped := fmt.Errorf("write result: %w", &mysql.MySQLError{Number: mysqlDeadlockErrNum})
	if !isRetryableTransactionError(wrapped) {
		t.Fatal("wrapped MySQLError 1213 should be retryable")
	}
}

func TestIsRetryableTransactionErrorFallsBackOnMessage(t *testing.T) {
	deadlock := errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction")
	if !isRetryableTransactionError(deadlock) {
		t.Fatal("deadlock message should be retryable")
	}
	if !isRetryableTransactionError(errors.New("Lock wait timeout exceeded; try restarting transaction")) {
		t.Fatal("lock wait timeout message should be retryable")
	}
	if isRetryableTransactionError(errors.New("unrelated")) {
		t.Fatal("unrelated error should not be retryable")
	}
}
