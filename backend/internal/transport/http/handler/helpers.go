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

package handler

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"

	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/errcode"
)

func reqctx(ctx *gin.Context) context.Context {
	return ctx.Request.Context()
}

func internalServerErrorResponse(ctx *gin.Context, err error) {
	code := errcode.CommonInternalError
	msg := "internal server error"
	httpStatus := http.StatusOK

	if ae, ok := apperr.As(err); ok {
		code = ae.Code()
		msg = ae.Message()
		if ae.HTTPStatus() != 0 {
			httpStatus = ae.HTTPStatus()
		}
	}

	ctx.JSON(httpStatus, gin.H{
		"code": code,
		"msg":  msg,
	})
}

func invalidParamRequestResponse(ctx *gin.Context, msg string) {
	ctx.JSON(http.StatusOK, gin.H{
		"code": errcode.CommonInvalidParam,
		"msg":  msg,
	})
}

func unauthorizedResponse(ctx *gin.Context, msgs ...string) {
	msg := "unauthorized"
	if len(msgs) > 0 && msgs[0] != "" {
		msg = msgs[0]
	}
	ctx.JSON(http.StatusUnauthorized, gin.H{
		"code": errcode.CommonUnauthorized,
		"msg":  msg,
	})
}
