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
