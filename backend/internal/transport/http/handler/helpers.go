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
