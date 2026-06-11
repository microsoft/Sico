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
	"strings"

	"github.com/go-sql-driver/mysql"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// Stable error message tokens. Python clients translate by status.Code first and
// fall back to substring matching on these tokens for legacy compatibility.
const (
	staleWorkerToken     = "stale worker token"
	notFoundToken        = "not found"
	duplicateKeyToken    = "duplicate key"
	mysqlDuplicateErrNum = 1062
	mysqlDeadlockErrNum  = 1213
	mysqlLockWaitErrNum  = 1205
)

// errStaleToken is an internal sentinel returned by ensureToken/ensureClaimable
// when a run's fencing state has moved on. The service layer translates this
// to a gRPC FailedPrecondition status before returning to the client.
var errStaleToken = errors.New(staleWorkerToken)

// IsStaleToken reports whether err is rooted in a stale-fencing-token condition.
func IsStaleToken(err error) bool {
	return errors.Is(err, errStaleToken)
}

// internalError wraps a transport/DB-level failure as a gRPC Internal error.
// It is intentionally opaque about the underlying error structure: leaking
// gorm error types across the wire would be a coupling smell.
func internalError(op string, err error) error {
	return status.Errorf(codes.Internal, "%s: %s", op, err.Error())
}

// notFoundError is returned when an entity is genuinely missing. This is
// distinct from "operation result == found:false": notFoundError is used when
// the caller asserted the entity exists (e.g. updating a specific run) and
// should treat absence as a hard failure.
func notFoundError(op, resource, id string) error {
	return status.Errorf(codes.NotFound, "%s: %s %s %s", op, resource, id, notFoundToken)
}

// stalePreconditionError signals that a fencing token is no longer valid (the
// run has been claimed by another worker or moved past the claimable state).
// FailedPrecondition is the correct gRPC code for "state changed under you".
func stalePreconditionError(runID, detail string) error {
	return status.Errorf(codes.FailedPrecondition, "run %s: %s: %s", runID, staleWorkerToken, detail)
}

// translateError maps internal errors to gRPC status errors with appropriate
// codes. This is the single chokepoint between the transactional/DB layer and
// the wire.
func translateError(op string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return status.Error(codes.NotFound, fmt.Sprintf("%s: %s", op, err.Error()))
	}
	if errors.Is(err, errStaleToken) {
		return status.Error(codes.FailedPrecondition, fmt.Sprintf("%s: %s", op, err.Error()))
	}
	if isDuplicateKey(err) {
		// AlreadyExists is the canonical gRPC code for unique-constraint
		// collisions. Python clients translate this to a retry by re-reading
		// the existing row via lookup_idempotent.
		return status.Error(codes.AlreadyExists, fmt.Sprintf("%s: %s: %s", op, duplicateKeyToken, err.Error()))
	}
	return internalError(op, err)
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
