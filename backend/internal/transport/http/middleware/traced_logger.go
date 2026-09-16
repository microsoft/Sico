package middleware

import (
	"time"

	"github.com/gin-gonic/gin"

	"sico-backend/pkg/logger"
)

func TracedLogger() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		start := time.Now()
		ctx.Next()

		route := ctx.FullPath()
		if route == "" {
			route = ctx.Request.URL.Path
		}
		logger.CtxInfo(
			ctx.Request.Context(),
			"http_request method=%s route=%s status=%d duration_ms=%d",
			ctx.Request.Method,
			route,
			ctx.Writer.Status(),
			time.Since(start).Milliseconds(),
		)
	}
}
