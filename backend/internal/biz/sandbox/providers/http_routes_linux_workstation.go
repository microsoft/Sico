package providers

import (
	"bytes"
	"fmt"
	"io"
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
)

func (p *LinuxWorkstationProvider) registerHTTPRoutes(routes *gin.RouterGroup, pool sandboxPool) {
	routes.Any("/resources/linux_workstation/:rid/*path", func(ctx *gin.Context) {
		p.resourceLinuxWorkstationProxy(ctx, pool)
	})
}

func (p *LinuxWorkstationProvider) resourceLinuxWorkstationProxy(ctx *gin.Context, pool sandboxPool) {
	resource, err := resolveResource(ctx, pool, p.Type())
	if err != nil {
		writeProxyError(ctx, http.StatusInternalServerError, err)
		return
	}
	target, err := url.Parse(strings.TrimRight(strings.TrimSpace(resource.ResourceID), "/"))
	if err != nil || target.Scheme == "" || target.Host == "" {
		writeProxyError(ctx, http.StatusInternalServerError, fmt.Errorf("invalid linux workstation resource id"))
		return
	}

	path := ctx.Param("path")
	switch strings.TrimRight(path, "/") {
	case "":
		path = "/index.html"
	case "/vnc":
		path = "/vnc/index.html"
	}
	if isWebSocketUpgrade(ctx.Request) {
		proxyLinuxWorkstationWebSocket(ctx, target, path)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(http.ResponseWriter, *http.Request, error) {
		writeProxyError(ctx, http.StatusInternalServerError, fmt.Errorf("linux workstation proxy error"))
	}
	proxy.ModifyResponse = rewriteLinuxWorkstationResponseForProxy(ctx.Param("rid"), target.String())
	originalDirector := proxy.Director
	proxy.Director = func(request *http.Request) {
		originalDirector(request)
		request.URL.Path = singleJoiningSlash(target.Path, path)
		request.Host = target.Host
		if strings.HasSuffix(path, ".html") {
			request.Header.Set("Accept-Encoding", "identity")
		}
		stripPrivateProxyInput(request)
	}
	proxy.ServeHTTP(ctx.Writer, ctx.Request)
}

func resolveResource(ctx *gin.Context, pool sandboxPool, sandboxType string) (*sandboximpl.Resource, error) {
	rid := strings.TrimSpace(ctx.Param("rid"))
	if rid == "" {
		return nil, fmt.Errorf("rid is required")
	}
	return pool.ResolveResourceByHash(ctx.Request.Context(), sandboxType, rid)
}

func rewriteLinuxWorkstationResponseForProxy(rid, upstream string) func(*http.Response) error {
	proxyBase := "/api/sico/sandbox/resources/linux_workstation/" + url.PathEscape(rid)
	parsed, _ := url.Parse(upstream)
	upstreamOrigin := ""
	if parsed != nil {
		upstreamOrigin = parsed.Scheme + "://" + parsed.Host
	}
	return func(response *http.Response) error {
		response.Header.Del("Content-Security-Policy")
		response.Header.Del("X-Frame-Options")
		if response.StatusCode >= 300 && response.StatusCode < 400 {
			response.Header.Set(
				"Location",
				rewriteUpstreamLocation(response.Header.Get("Location"), upstreamOrigin, proxyBase),
			)
			return nil
		}
		if response.StatusCode != http.StatusOK || response.Body == nil ||
			!strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
			return nil
		}
		body, err := io.ReadAll(response.Body)
		if err != nil {
			return err
		}
		_ = response.Body.Close()
		replacements := [][2]string{
			{`href="/`, `href="` + proxyBase + `/`}, {`src="/`, `src="` + proxyBase + `/`},
			{`action="/`, `action="` + proxyBase + `/`}, {`'/v1/shell/ws'`, `'` + proxyBase + `/v1/shell/ws'`},
			{`"/v1/shell/ws"`, `"` + proxyBase + `/v1/shell/ws"`}, {`'/v1/docs'`, `'` + proxyBase + `/v1/docs'`},
			{`"/v1/docs"`, `"` + proxyBase + `/v1/docs"`},
			{`'/v1/openapi.json'`, `'` + proxyBase + `/v1/openapi.json'`},
			{`"/v1/openapi.json"`, `"` + proxyBase + `/v1/openapi.json"`},
			{`'/v1/docs/oauth2-redirect'`, `'` + proxyBase + `/v1/docs/oauth2-redirect'`},
			{`"/v1/docs/oauth2-redirect"`, `"` + proxyBase + `/v1/docs/oauth2-redirect"`},
			{`resize: 'scale'`, `scale: 'true'`},
			{`baseUrl: '/code-server/'`, `baseUrl: '` + proxyBase + `/code-server/'`},
			{`baseUrl: '/vnc/index.html'`, `baseUrl: '` + proxyBase + `/vnc/index.html'`},
			{`baseUrl: '/vnc/vnc_lite.html'`, `baseUrl: '` + proxyBase + `/vnc/vnc_lite.html'`},
			{`baseUrl: '/terminal'`, `baseUrl: '` + proxyBase + `/terminal'`},
			{`baseUrl: '/jupyter/lab'`, `baseUrl: '` + proxyBase + `/jupyter/lab'`},
		}
		for _, replacement := range replacements {
			body = bytes.ReplaceAll(body, []byte(replacement[0]), []byte(replacement[1]))
		}
		wsPath := strings.TrimPrefix(proxyBase, "/") + "/vnc/websockify"
		body = bytes.ReplaceAll(body, []byte(`value="websockify"`), []byte(fmt.Sprintf(`value="%s"`, wsPath)))
		response.Body = io.NopCloser(bytes.NewReader(body))
		response.ContentLength = int64(len(body))
		response.Header.Set("Content-Length", strconv.Itoa(len(body)))
		return nil
	}
}

func rewriteUpstreamLocation(location, upstreamOrigin, proxyBase string) string {
	parsed, err := url.Parse(location)
	if err != nil || !parsed.IsAbs() {
		return location
	}
	if parsed.Scheme+"://"+parsed.Host == upstreamOrigin {
		return joinedProxyLocation(proxyBase, parsed)
	}
	for _, prefix := range []string{"/code-server", "/vnc", "/terminal", "/jupyter"} {
		if parsed.Path == prefix || strings.HasPrefix(parsed.Path, prefix+"/") {
			return joinedProxyLocation(proxyBase, parsed)
		}
	}
	return location
}

func joinedProxyLocation(proxyBase string, parsed *url.URL) string {
	result := singleJoiningSlash(proxyBase, parsed.Path)
	if parsed.RawQuery != "" {
		result += "?" + parsed.RawQuery
	}
	return result
}

func proxyLinuxWorkstationWebSocket(ctx *gin.Context, target *url.URL, path string) {
	upstreamPath := path
	if strings.HasSuffix(path, "/websockify") {
		upstreamPath = "/websockify"
	}
	scheme := "ws"
	if target.Scheme == "https" {
		scheme = "wss"
	}
	upstream := (&url.URL{
		Scheme:   scheme,
		Host:     target.Host,
		Path:     singleJoiningSlash(target.Path, upstreamPath),
		RawQuery: ctx.Request.URL.RawQuery,
	}).String()
	proxyClientToUpstreamWS(ctx, upstream, websocket.Subprotocols(ctx.Request))
}

func proxyClientToUpstreamWS(ctx *gin.Context, upstream string, subprotocols []string) {
	if err := proxyClientToUpstreamWSWithError(ctx, upstream, subprotocols); err != nil {
		log.Printf("[Sandbox WS Proxy] %v", err)
	}
}

func proxyClientToUpstreamWSWithError(ctx *gin.Context, upstream string, subprotocols []string) error {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(*http.Request) bool { return true }, Subprotocols: subprotocols,
		ReadBufferSize: 65536, WriteBufferSize: 65536,
	}
	client, err := upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second, Subprotocols: subprotocols, ReadBufferSize: 65536, WriteBufferSize: 65536,
	}
	server, _, err := dialer.Dial(upstream, nil)
	if err != nil {
		_ = client.WriteMessage(websocket.TextMessage, []byte("upstream websocket dial failed: "+err.Error()))
		return err
	}
	defer func() { _ = server.Close() }()
	proxyWebSocketBidirectional(client, server)
	return nil
}

func stripPrivateProxyInput(request *http.Request) {
	query := request.URL.Query()
	query.Del("rid")
	request.URL.RawQuery = query.Encode()
	for key := range request.Header {
		if strings.HasPrefix(strings.ToLower(key), "x-sico-") {
			request.Header.Del(key)
		}
	}
}

func isWebSocketUpgrade(request *http.Request) bool {
	return strings.EqualFold(request.Header.Get("Upgrade"), "websocket")
}

func writeProxyError(ctx *gin.Context, status int, err error) {
	ctx.AbortWithStatusJSON(status, gin.H{"code": 1, "msg": err.Error()})
}
