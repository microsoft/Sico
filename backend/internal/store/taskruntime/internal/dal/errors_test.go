package dal

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-sql-driver/mysql"
)

func TestIsStaleTokenIdentifiesWrappedErrors(t *testing.T) {
	if IsStaleToken(nil) {
		t.Fatal("nil should not be a stale token")
	}
	if IsStaleToken(errors.New("other")) {
		t.Fatal("unrelated error should not be a stale token")
	}
	if !IsStaleToken(fmt.Errorf("ctx: %w", ErrStaleToken)) {
		t.Fatal("wrapped ErrStaleToken should be detected")
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

func TestIsDuplicateKeyFallsBackOnMessage(t *testing.T) {
	// Some driver/test doubles surface a plain error carrying the duplicate-entry
	// message but no underlying *mysql.MySQLError. The string fallback must still
	// classify it so the AlreadyExists mapping survives.
	if !isDuplicateKey(errors.New("Error 1062 (23000): Duplicate entry 'x' for key 'uniq'")) {
		t.Fatal("plain error with a 'Duplicate entry' message should be a duplicate key")
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
