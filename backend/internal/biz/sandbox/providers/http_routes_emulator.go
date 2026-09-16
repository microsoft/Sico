package providers

import (
	_ "embed"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	sandboximpl "sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
)

//go:embed emulator_view.html
var embeddedEmulatorViewHTML string

func (p *EmulatorProvider) registerAuthorizedHTTPRoutes(
	routes *gin.RouterGroup,
	pool sandboxPool,
	authorizer resourceProxyAuthorizer,
) {
	routes.GET("/resources/emulator/:rid/vnc", p.resourceUI)
	routes.GET("/resources/emulator/:rid/ws/h264", func(ctx *gin.Context) {
		p.resourceH264WebSocket(ctx, pool, authorizer)
	})
	routes.Any("/resources/emulator/:rid/api/*path", func(ctx *gin.Context) {
		p.resourceAPIProxy(ctx, pool, authorizer)
	})
}

func (p *EmulatorProvider) resourceUI(ctx *gin.Context) {
	rid := strings.TrimSpace(ctx.Param("rid"))
	if rid == "" {
		writeInvalidSandboxParameter(ctx, "rid is required")
		return
	}

	wsPath := fmt.Sprintf("/api/sico/sandbox/resources/emulator/%s/ws/h264", url.PathEscape(rid))
	viewStart := strings.Index(embeddedEmulatorViewHTML, "<!doctype html>")
	if viewStart < 0 {
		writeSandboxHandlerError(ctx, fmt.Errorf("emulator viewer unavailable"))
		return
	}
	html := strings.Replace(embeddedEmulatorViewHTML[viewStart:], "__WS_PATH__", strconv.Quote(wsPath), 1)
	ctx.Header("Content-Type", "text/html; charset=utf-8")
	ctx.String(http.StatusOK, "%s", html)
}

func (p *EmulatorProvider) resourceAPIProxy(
	ctx *gin.Context,
	pool sandboxPool,
	authorizer resourceProxyAuthorizer,
) {
	if !authenticateBackendRequest(ctx) {
		return
	}
	resource, ok := p.resolveResource(ctx, pool)
	if !ok {
		return
	}
	if !authorizeEmulatorResource(ctx, authorizer, resource) {
		return
	}
	baseURL, deviceID, err := p.ParseResourceIDForProxy(resource.ResourceID)
	if err != nil {
		writeSandboxHandlerError(ctx, err)
		return
	}
	path := ctx.Param("path")
	if !emulatorAPIRequestTargetsResource(path, deviceID) &&
		!authorizeEmulatorProviderOperation(ctx, authorizer) {
		return
	}
	target, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		writeSandboxHandlerError(ctx, err)
		return
	}

	if path == "" {
		path = "/"
	}
	upstreamPath := "/api" + path
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(http.ResponseWriter, *http.Request, error) {
		writeSandboxHandlerError(ctx, fmt.Errorf("emulator proxy error"))
	}
	originalDirector := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalDirector(request)
		request.URL.Path = singleJoiningSlash(target.Path, upstreamPath)
		request.Host = target.Host
		request.URL.RawQuery = ctx.Request.URL.RawQuery
		for header := range request.Header {
			if strings.HasPrefix(strings.ToLower(header), "x-sico-") {
				request.Header.Del(header)
			}
		}
		request.Header.Set("Authorization", "Bearer "+p.serviceToken)
	}
	proxy.ServeHTTP(ctx.Writer, ctx.Request)
}

func emulatorAPIRequestTargetsResource(path, deviceID string) bool {
	segments, ok := emulatorAPIPathSegments(path)
	if !ok || len(segments) < 3 || segments[0] != "v1" {
		return false
	}
	if segments[1] == "devices" {
		return segments[2] == deviceID
	}
	if segments[1] != "emulators" {
		return false
	}
	return segments[2] == deviceID && (len(segments) < 4 || segments[3] != "clone")
}

func emulatorAPIPathSegments(path string) ([]string, bool) {
	rawSegments := strings.Split(strings.Trim(path, "/"), "/")
	segments := make([]string, len(rawSegments))
	for index, rawSegment := range rawSegments {
		segment, err := url.PathUnescape(rawSegment)
		if err != nil || segment == "" || segment == "." || segment == ".." || strings.Contains(segment, "/") {
			return nil, false
		}
		segments[index] = segment
	}
	return segments, true
}

func (p *EmulatorProvider) resourceH264WebSocket(
	ctx *gin.Context,
	pool sandboxPool,
	authorizer resourceProxyAuthorizer,
) {
	upgrader := websocket.Upgrader{
		ReadBufferSize: 32768, WriteBufferSize: 32768,
		CheckOrigin: checkSameOrigin,
	}
	client, err := upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		return
	}

	defer func() { _ = client.Close() }()
	if !authenticateBackendWebSocket(ctx, client) {
		return
	}
	rid := strings.TrimSpace(ctx.Param("rid"))
	if rid == "" {
		closeBackendWebSocket(client, 4400, "rid is required")
		return
	}

	resource, err := pool.ResolveResourceByHash(ctx.Request.Context(), p.Type(), rid)
	if err != nil {
		if appError, ok := apperr.As(err); ok &&
			(appError.Code() == errcode.CommonNotFound || appError.Code() == errcode.SandboxNoAvailableResource) {
			closeBackendWebSocket(client, 4404, "resource not found")
		} else {
			closeBackendWebSocket(client, 1011, "resource lookup unavailable")
		}
		return
	}
	if authorizer == nil {
		closeBackendWebSocket(client, 1011, "resource authorization unavailable")
		return
	}

	if err := authorizer.AuthorizeResourceProxy(ctx.Request.Context(), resource); err != nil {
		if isResourceAccessDenied(err) {
			closeBackendWebSocket(client, 4403, "resource access denied")
		} else {
			closeBackendWebSocket(client, 1011, "resource authorization unavailable")
		}
		return
	}

	baseURL, deviceID, err := p.ParseResourceIDForProxy(resource.ResourceID)
	if err != nil {
		closeBackendWebSocket(client, 4400, "invalid emulator resource")
		return
	}
	query := ctx.Request.URL.Query()
	query.Del("rid")
	encodedQuery := query.Encode()
	if strings.TrimSpace(encodedQuery) == "" {
		encodedQuery = "max_size=900&bit_rate=4000000&max_fps=24"
	}
	upstream := fmt.Sprintf(
		"%s/api/v1/devices/%s/ws/h264?%s",
		toWebSocketURL(strings.TrimRight(baseURL, "/")),
		url.PathEscape(deviceID),
		encodedQuery,
	)

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	upstreamHeaders := http.Header{}
	upstreamHeaders.Set("Authorization", "Bearer "+p.serviceToken)
	server, _, err := dialer.DialContext(ctx.Request.Context(), upstream, upstreamHeaders)
	if err != nil {
		log.Printf("[Emulator WS Proxy] Failed to dial upstream %s: %v", upstream, err)
		_ = client.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":"upstream dial failed"}`))
		return
	}

	defer func() { _ = server.Close() }()
	proxyEmulatorWebSocketBidirectional(client, server)
}

func (p *EmulatorProvider) resolveResource(
	ctx *gin.Context,
	pool sandboxPool,
) (*sandboximpl.Resource, bool) {
	rid := strings.TrimSpace(ctx.Param("rid"))
	if rid == "" {
		writeInvalidSandboxParameter(ctx, "rid is required")
		return nil, false
	}
	resource, err := pool.ResolveResourceByHash(ctx.Request.Context(), p.Type(), rid)
	if err != nil {
		writeSandboxHandlerError(ctx, err)
		return nil, false
	}
	return resource, true
}

func toWebSocketURL(rawURL string) string {
	switch {
	case strings.HasPrefix(rawURL, "https://"):
		return "wss://" + strings.TrimPrefix(rawURL, "https://")
	case strings.HasPrefix(rawURL, "http://"):
		return "ws://" + strings.TrimPrefix(rawURL, "http://")
	default:
		return rawURL
	}
}

func writeSandboxHandlerError(ctx *gin.Context, err error) {
	code := errcode.CommonInternalError
	message := "internal server error"
	httpStatus := http.StatusOK
	if appError, ok := apperr.As(err); ok {
		code = appError.Code()
		message = appError.Message()
		if appError.HTTPStatus() != 0 {
			httpStatus = appError.HTTPStatus()
		}
	}
	ctx.JSON(httpStatus, gin.H{"code": code, "msg": message})
}

func writeInvalidSandboxParameter(ctx *gin.Context, message string) {
	ctx.JSON(http.StatusOK, gin.H{"code": errcode.CommonInvalidParam, "msg": message})
}
