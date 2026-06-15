package dal

import (
	"errors"
	"strings"

	"github.com/go-sql-driver/mysql"
)

// Stable error message tokens. Python clients translate by gRPC status code
// first and fall back to substring matching on these tokens for legacy
// compatibility, so the wording is part of the contract.
const (
	staleWorkerToken     = "stale worker token"
	duplicateKeyToken    = "duplicate key"
	mysqlDuplicateErrNum = 1062
	mysqlDeadlockErrNum  = 1213
	mysqlLockWaitErrNum  = 1205
)

// ErrStaleToken is the sentinel returned when a run's fencing state has moved on
// (the run was claimed by another worker, is no longer claimable, or a reopen
// failed its compare-and-set guard). The transport layer maps it to a gRPC
// FailedPrecondition status.
var ErrStaleToken = errors.New(staleWorkerToken)

// ErrDuplicate is the sentinel returned when a create collides with an existing
// row that is not an idempotent match. The transport layer maps it to a gRPC
// AlreadyExists status so clients can re-read the existing row.
var ErrDuplicate = errors.New(duplicateKeyToken)

// IsStaleToken reports whether err is rooted in a stale-fencing-token condition.
func IsStaleToken(err error) bool {
	return errors.Is(err, ErrStaleToken)
}

// IsDuplicateKey reports whether err is a MySQL duplicate-key violation. It is
// exported so the transport layer can still map a raw driver duplicate (for
// example from a unique-constraint update) to a gRPC AlreadyExists status.
func IsDuplicateKey(err error) bool {
	return isDuplicateKey(err)
}

// isDuplicateKey reports whether err is a MySQL 1062 duplicate-key error or
// carries the standard duplicate-key marker in its message. Some driver layers
// wrap the underlying mysql.MySQLError, so we also do a defensive substring
// check as a last resort.
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}

	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == mysqlDuplicateErrNum {
		return true
	}

	return strings.Contains(err.Error(), "Duplicate entry")
}

func isRetryableTransactionError(err error) bool {
	if err == nil {
		return false
	}

	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return mysqlErr.Number == mysqlDeadlockErrNum || mysqlErr.Number == mysqlLockWaitErrNum
	}

	message := err.Error()
	return strings.Contains(message, "Deadlock found when trying to get lock") ||
		strings.Contains(message, "Lock wait timeout exceeded") ||
		strings.Contains(message, "Error 1213") ||
		strings.Contains(message, "Error 1205") ||
		strings.Contains(message, "SQLSTATE 40001")
}
