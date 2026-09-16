package providers

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	"sico-backend/internal/transport/http/middleware"
)

type websocketAuthMessage struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

func authenticateBackendRequest(ctx *gin.Context) bool {
	if _, ok := middleware.GetUserFromContext(ctx.Request.Context()); ok {
		return true
	}

	token := strings.TrimSpace(ctx.GetHeader("Authorization"))
	token = strings.TrimSpace(strings.TrimPrefix(token, middleware.BearerScheme))
	user, err := middleware.AuthenticateToken(ctx.Request.Context(), token)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
		return false
	}

	setBackendUser(ctx, *user)
	return true
}

func authenticateBackendWebSocket(ctx *gin.Context, connection *websocket.Conn) bool {
	_ = connection.SetReadDeadline(time.Now().Add(5 * time.Second))
	var auth websocketAuthMessage
	if err := connection.ReadJSON(&auth); err != nil || auth.Type != "auth" {
		closeBackendWebSocket(connection, 4401, "authentication required")
		return false
	}

	user, err := middleware.AuthenticateToken(ctx.Request.Context(), auth.Token)
	if err != nil {
		closeBackendWebSocket(connection, 4401, "invalid or expired token")
		return false
	}

	setBackendUser(ctx, *user)
	_ = connection.SetReadDeadline(time.Time{})
	return true
}

func authorizeEmulatorResource(
	ctx *gin.Context,
	authorizer resourceProxyAuthorizer,
	resource *sandboximpl.Resource,
) bool {
	if authorizer == nil {
		ctx.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "resource authorization unavailable"})
		return false
	}

	if err := authorizer.AuthorizeResourceProxy(ctx.Request.Context(), resource); err != nil {
		status := http.StatusServiceUnavailable
		message := "resource authorization unavailable"
		if isResourceAccessDenied(err) {
			status = http.StatusForbidden
			message = "resource access denied"
		}
		ctx.AbortWithStatusJSON(status, gin.H{"error": message})
		return false
	}

	return true
}

func authorizeEmulatorProviderOperation(
	ctx *gin.Context,
	authorizer resourceProxyAuthorizer,
) bool {
	if authorizer == nil {
		ctx.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "resource authorization unavailable"})
		return false
	}

	if err := authorizer.AuthorizeSandboxProviderOperation(ctx.Request.Context()); err != nil {
		status := http.StatusServiceUnavailable
		message := "resource authorization unavailable"
		if isResourceAccessDenied(err) {
			status = http.StatusForbidden
			message = "sandbox provider operation access denied"
		}
		ctx.AbortWithStatusJSON(status, gin.H{"error": message})
		return false
	}

	return true
}

func isResourceAccessDenied(err error) bool {
	appError, ok := apperr.As(err)
	return ok && (appError.Code() == errcode.CommonForbidden || appError.Code() == errcode.CommonUnauthorized)
}

func setBackendUser(ctx *gin.Context, user middleware.UserInfo) {
	ctx.Set(middleware.ContextUserKey, user)
	ctx.Request = ctx.Request.WithContext(context.WithValue(
		ctx.Request.Context(),
		middleware.ContextUserKey,
		user,
	))
}

func closeBackendWebSocket(connection *websocket.Conn, code int, reason string) {
	_ = connection.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(code, reason),
		time.Now().Add(time.Second),
	)
}

func checkSameOrigin(request *http.Request) bool {
	origin := strings.TrimSpace(request.Header.Get("Origin"))
	parsed, err := url.Parse(origin)

	return err == nil && parsed.Host != "" && strings.EqualFold(parsed.Host, request.Host)
}
