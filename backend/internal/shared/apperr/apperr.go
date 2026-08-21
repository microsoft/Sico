package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// Error is an application error carrying a stable business error code and
// a user-facing message.
//
// Code is a stable int32 business error code (NOT HTTP status).
// HTTPStatus is the HTTP status for HTTP transport.
// Cause is optional and should not be exposed to clients.
//
// This pattern follows common best practices in Go services: errors are typed,
// wrap-able, and can be mapped at the transport boundary.
// (See also patterns used in Kubernetes/apimachinery and many internal service frameworks.)
//
// NOTE: keep this type small and dependency-free.
type Error struct {
	code       int32
	msg        string
	httpStatus int
	cause      error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.cause == nil {
		return e.msg
	}

	return fmt.Sprintf("%s: %v", e.msg, e.cause)
}

func (e *Error) Unwrap() error { return e.cause }

func (e *Error) Code() int32 { return e.code }

func (e *Error) Message() string { return e.msg }

func (e *Error) HTTPStatus() int { return e.httpStatus }

// New creates a business error that should be returned as HTTP 200.
// Transport should interpret non-zero code in the response body.
func New(code int32, msg string) *Error {
	return &Error{code: code, msg: msg, httpStatus: http.StatusOK}
}

// Wrap creates a business error (HTTP 200) while keeping an internal cause for logging.
func Wrap(code int32, msg string, cause error) *Error {
	return &Error{code: code, msg: msg, httpStatus: http.StatusOK, cause: cause}
}

// Internal is an optional helper for explicitly marking internal failures.
// Most code can simply return the raw cause and let transport map it to 500.
func Internal(code int32, msg string, cause error) *Error {
	return &Error{code: code, msg: msg, httpStatus: http.StatusInternalServerError, cause: cause}
}

func As(err error) (*Error, bool) {
	var ae *Error
	if errors.As(err, &ae) {
		return ae, true
	}

	return nil, false
}
