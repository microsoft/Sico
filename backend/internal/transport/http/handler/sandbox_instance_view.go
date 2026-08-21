package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	sandboxbiz "sico-backend/internal/biz/sandbox"
	"sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/enum"
	"sico-backend/internal/errcode"
	"sico-backend/internal/shared/apperr"
	commondto "sico-backend/internal/transport/http/dto/common"
	"sico-backend/pkg/safego"
)

func mustGetSandboxImplServiceFromDefault(c *gin.Context) (*impl.Service, bool) {
	implSvc, ok := sandboxbiz.DefaultImplService()
	if !ok || implSvc == nil || implSvc.Pool == nil {
		internalServerErrorResponse(c, fmt.Errorf("sandbox service not available"))
		return nil, false
	}

	return implSvc, true
}

type emulatorResourceParser interface {
	ParseResourceIDForProxy(resourceID string) (baseURL, deviceID string, err error)
}

// isWebSocketUpgrade checks if the request is a WebSocket upgrade request.
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

// instanceEmulatorHTMLTemplate is the HTML+JS for the backend-owned emulator viewer.
// It contains a single %q placeholder for the WebSocket path and %% literals for CSS.
const instanceEmulatorHTMLTemplate = `<!doctype html>
<html>
<head>
	<meta charset="utf-8"/>
	<meta name="viewport" content="width=device-width,initial-scale=1"/>
	<title>Emulator Live View</title>
	<style>
		body{font-family:ui-sans-serif,system-ui;margin:16px;background:#f8fafc;display:flex;` +
	`flex-direction:column;justify-content:center;align-items:center;touch-action:none}
		canvas{max-width:100%%;border:1px solid #ddd;border-radius:8px;background:#fff}
		#status{position:fixed;top:8px;left:8px;color:#334155;` +
	`font-size:11px;font-family:ui-sans-serif,system-ui;z-index:20}
		.row{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
		.hint{color:#666;font-size:12px;margin-top:8px;line-height:1.4}
	</style>
</head>
<body>
	<div class="row">
		<span id="status" class="hint"></span>
	</div>
	<canvas id="c" width="960" height="540"></canvas>
	<div class="hint">If video doesn’t show, your browser may not support WebCodecs.</div>
	<script>
		const wsPath = %q;
		const statusEl = document.getElementById('status');
		function setStatus(s){statusEl.textContent=s;}

		function wsUrl(){
			const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
			const q = location.search || '';
			return proto + location.host + wsPath + q;
		}

		const canvas = document.getElementById('c');
		const ctx = canvas.getContext('2d');
		let decoder = null;
		let configured = false;
		let ws = null;
		let reconnectTimer = null;
		let reconnectAttempts = 0;
		const maxReconnectDelay = 10000;

		function b64ToU8(b64){
			const bin = atob(b64);
			const u8 = new Uint8Array(bin.length);
			for(let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
			return u8;
		}

		function u8ToBigIntBE(u8, offset){
			let x = 0n;
			for(let i=0;i<8;i++) x = (x<<8n) + BigInt(u8[offset+i]);
			return x;
		}

		function scheduleReconnect(){
			if(reconnectTimer) return;
			const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), maxReconnectDelay);
			reconnectAttempts++;
			setStatus('Reconnecting...');
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				start();
			}, delay);
		}

		function start(){
			if(!('VideoDecoder' in window)){
				setStatus('WebCodecs not supported.');
				return;
			}

			// Close existing connections
			if(ws){ try{ ws.close(); } catch(_){} }
			if(decoder){ try{ decoder.close(); } catch(_){} }
			configured = false;

			const u = wsUrl();
			setStatus('Connecting...');
			ws = new WebSocket(u);
			ws.binaryType = 'arraybuffer';
			const configTimeout = setTimeout(() => {
				if(!configured){
					setStatus('No codec config received.');
				}
			}, 5000);

			decoder = new VideoDecoder({
				output: (frame) => {
					try{
						const w = frame.displayWidth || frame.codedWidth;
						const h = frame.displayHeight || frame.codedHeight;
						if(w && h && (canvas.width !== w || canvas.height !== h)){
							canvas.width = w; canvas.height = h;
						}
						ctx.drawImage(frame, 0, 0);
					} finally {
						frame.close();
					}
				},
				error: (e) => { setStatus('Decoder error: ' + e); }
			});

			ws.onopen = () => {
				reconnectAttempts = 0;
				setStatus('');
			};
			ws.onclose = () => {
				clearTimeout(configTimeout);
				scheduleReconnect();
			};
			ws.onerror = () => setStatus('WebSocket error.');

			ws.onmessage = (ev) => {
				if(typeof ev.data === 'string'){
					try{
						const cfg = JSON.parse(ev.data);
						if(cfg && cfg.type === 'config' && cfg.codec){
							if(cfg.description){
								const desc = b64ToU8(cfg.description);
								decoder.configure({codec: cfg.codec, description: desc});
							} else {
								decoder.configure({codec: cfg.codec});
							}
							configured = true;
							clearTimeout(configTimeout);
							setStatus('');
						}
					} catch(_) {}
					return;
				}

				if(!configured) return;
				const buf = new Uint8Array(ev.data);
				if(buf.length < 9) return;
				const isKey = buf[0] === 1;
				const ts = Number(u8ToBigIntBE(buf, 1));
				const payload = buf.subarray(9);
				const chunk = new EncodedVideoChunk({
					type: isKey ? 'key' : 'delta', timestamp: ts, data: payload});
				decoder.decode(chunk);
			};
		}

		// Reconnect when page becomes visible (e.g., switching tabs)
		document.addEventListener('visibilitychange', () => {
			if(document.visibilityState === 'visible' && (!ws || ws.readyState !== WebSocket.OPEN)){
				if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
				reconnectAttempts = 0;
				start();
			}
		});

		start();
	</script>
</body>
</html>`

// InstanceEmulatorUI renders a backend-owned HTML viewer that connects to the backend WS proxy.
func InstanceEmulatorUI(c *gin.Context) {
	instanceID := strings.TrimSpace(c.Param("instanceId"))
	if instanceID == "" {
		invalidParamRequestResponse(c, "instanceId is required")
		return
	}

	wsPath := fmt.Sprintf("/api/sico/sandbox/instance/%s/emulator/ws/h264", url.PathEscape(instanceID))
	c.Header("Content-Type", "text/html; charset=utf-8")
	html := fmt.Sprintf(instanceEmulatorHTMLTemplate, wsPath)

	c.String(http.StatusOK, "%s", html)
}

// InstanceEmulatorH264WS reverse-proxies the emulator H264 WebSocket stream for an instance's lease.
func InstanceEmulatorH264WS(c *gin.Context) {
	instanceID := strings.TrimSpace(c.Param("instanceId"))
	if instanceID == "" {
		invalidParamRequestResponse(c, "instanceId is required")
		return
	}

	implSvc, ok := mustGetSandboxImplServiceFromDefault(c)
	if !ok {
		return
	}

	manager := implSvc.Pool
	lease, err := manager.GetAssignedLease(reqctx(c), instanceID, enum.SandboxTypeEmulator.String())
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}
	if lease == nil {
		internalServerErrorResponse(c, apperr.New(errcode.SandboxLeaseNotFound, "no emulator lease for instance"))
		return
	}

	prov, ok := implSvc.Pool.GetProvider(enum.SandboxTypeEmulator.String())
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("emulator provider not available"))
		return
	}
	emu, ok := prov.(emulatorResourceParser)
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("invalid emulator provider"))
		return
	}

	baseURL, deviceID, err := emu.ParseResourceIDForProxy(lease.ResourceID)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	query := strings.TrimPrefix(c.Request.URL.RawQuery, "?")
	if strings.TrimSpace(query) == "" {
		query = "max_size=1080&bit_rate=8000000"
	}
	wsBaseURL := httpToWebsocketURL(strings.TrimRight(baseURL, "/"))
	upstream := fmt.Sprintf("%s/api/v1/devices/%s/ws/h264?%s", wsBaseURL, url.PathEscape(deviceID), query)

	upgrader := websocket.Upgrader{
		ReadBufferSize:  32768,
		WriteBufferSize: 32768,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	clientConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer func() {
		_ = clientConn.Close()
	}()

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	upstreamConn, _, err := dialer.DialContext(reqctx(c), upstream, nil)
	if err != nil {
		_ = clientConn.WriteMessage(websocket.TextMessage, []byte("upstream websocket dial failed"))
		return
	}
	defer func() {
		_ = upstreamConn.Close()
	}()

	proxyWebSocketBidirectional(clientConn, upstreamConn)
}

func proxyWebSocketBidirectional(clientConn, upstreamConn *websocket.Conn) {
	errCh := make(chan error, 2)
	stopCh := make(chan struct{})
	defer close(stopCh)
	reportErr := makeWSErrReporter(errCh)

	ctx := context.Background()
	safego.Go(ctx, func() { wsKeepAlive(clientConn, stopCh, reportErr) })
	safego.Go(ctx, func() { wsKeepAlive(upstreamConn, stopCh, reportErr) })
	safego.Go(ctx, func() { wsProxyCopy(upstreamConn, clientConn, reportErr) })
	safego.Go(ctx, func() { wsProxyCopy(clientConn, upstreamConn, reportErr) })
	<-errCh

	closeDeadline := time.Now().Add(1 * time.Second)
	_ = clientConn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		closeDeadline,
	)
	_ = upstreamConn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		closeDeadline,
	)
}

// makeWSErrReporter returns a non-blocking reporter that forwards the first error to errCh.
func makeWSErrReporter(errCh chan<- error) func(error) {
	return func(err error) {
		if err == nil {
			return
		}
		select {
		case errCh <- err:
		default:
		}
	}
}

// wsKeepAlive sends periodic ping frames on conn until stopCh is closed.
func wsKeepAlive(conn *websocket.Conn, stopCh <-chan struct{}, reportErr func(error)) {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			deadline := time.Now().Add(10 * time.Second)
			if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), deadline); err != nil {
				reportErr(err)
				return
			}
		}
	}
}

// wsProxyCopy copies messages from src to dst until either side errors.
func wsProxyCopy(dst, src *websocket.Conn, reportErr func(error)) {
	for {
		msgType, data, err := src.ReadMessage()
		if err != nil {
			reportErr(err)
			return
		}
		if err := dst.WriteMessage(msgType, data); err != nil {
			reportErr(err)
			return
		}
	}
}

func isJSONContentType(contentType string) bool {
	return strings.Contains(contentType, "application/json") || strings.Contains(contentType, "+json")
}

// proxyToSandbox proxies the request to the underlying sandbox provider
func proxyToSandbox(c *gin.Context, leaseOwnerID, sandboxType, targetPath string) {
	// Get service (unwrap tracing wrapper)
	implSvc, ok := sandboxbiz.DefaultImplService()
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("sandbox service not available"))
		return
	}

	// Get pre-assigned lease
	lease, err := implSvc.Pool.GetAssignedLease(reqctx(c), leaseOwnerID, sandboxType)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}
	if lease == nil {
		internalServerErrorResponse(c, apperr.New(errcode.SandboxLeaseNotFound, "no sandbox lease for instance"))
		return
	}

	// Get provider
	provider, ok := implSvc.Pool.GetProvider(lease.Type)
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("sandbox provider not available"))
		return
	}

	// Build target URL
	var targetURL string
	if lease.Type == enum.SandboxTypeEmulator.String() {
		if emulatorProv, ok := provider.(emulatorResourceParser); ok {
			baseURL, deviceID, err := emulatorProv.ParseResourceIDForProxy(lease.ResourceID)
			if err != nil {
				internalServerErrorResponse(c, fmt.Errorf("failed to parse emulator resource ID: %w", err))
				return
			}

			// For emulator, targetPath like "/adb/tap" becomes "/api/v1/emulators/{deviceID}/adb/tap"
			baseURL = strings.TrimRight(baseURL, "/")
			targetPath = strings.TrimLeft(targetPath, "/")
			targetURL = fmt.Sprintf("%s/api/v1/emulators/%s/%s", baseURL, deviceID, targetPath)
		}
	}

	if targetURL == "" {
		internalServerErrorResponse(c, fmt.Errorf("failed to build target URL for sandbox"))
		return
	}
	log.Printf("Proxying request: %s %s -> %s", c.Request.Method, c.Request.URL.Path, targetURL)

	proxyToTargetURL(c, targetURL)
}

func proxyToTargetURL(c *gin.Context, targetURL string) {
	bodyReader, err := readProxyRequestBody(c)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	proxyReq, err := http.NewRequestWithContext(reqctx(c), c.Request.Method, targetURL, bodyReader)
	if err != nil {
		internalServerErrorResponse(c, fmt.Errorf("failed to create proxy request: %w", err))
		return
	}

	copyProxyRequestHeaders(c.Request.Header, proxyReq.Header)

	client := &http.Client{Timeout: 60 * time.Second}
	proxyResp, err := client.Do(proxyReq)
	if err != nil {
		internalServerErrorResponse(c, fmt.Errorf("failed to proxy request: %w", err))
		return
	}
	defer func() {
		_ = proxyResp.Body.Close()
	}()

	contentType := strings.ToLower(proxyResp.Header.Get("Content-Type"))
	if isJSONContentType(contentType) {
		writeProxyJSONResponse(c, proxyResp)
		return
	}

	for key, values := range proxyResp.Header {
		for _, value := range values {
			c.Header(key, value)
		}
	}

	c.Status(proxyResp.StatusCode)
	if _, err := io.Copy(c.Writer, proxyResp.Body); err != nil {
		log.Printf("Failed to copy proxy response: %v", err)
	}
}

// readProxyRequestBody fully reads the incoming request body into a reusable reader.
func readProxyRequestBody(c *gin.Context) (io.Reader, error) {
	if c.Request.Body == nil {
		return nil, nil
	}

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	return bytes.NewReader(bodyBytes), nil
}

// copyProxyRequestHeaders copies incoming headers to the outgoing proxy request while
// stripping hop-by-hop/sico-internal headers.
func copyProxyRequestHeaders(src, dst http.Header) {
	for key, values := range src {
		lk := strings.ToLower(key)
		if strings.HasPrefix(lk, "x-sico-") {
			continue
		}
		if lk == "host" || lk == "connection" {
			continue
		}
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

// writeProxyJSONResponse handles the JSON-wrapped StandardResponse body path for
// upstream responses with a JSON content type.
func writeProxyJSONResponse(c *gin.Context, proxyResp *http.Response) {
	bodyBytes, err := io.ReadAll(proxyResp.Body)
	if err != nil {
		internalServerErrorResponse(c, fmt.Errorf("failed to read proxy response: %w", err))
		return
	}

	if proxyResp.StatusCode >= http.StatusBadRequest {
		msg := strings.TrimSpace(string(bodyBytes))
		if msg == "" {
			msg = "sandbox upstream error"
		}
		internalServerErrorResponse(c, fmt.Errorf("sandbox upstream error: %s", msg))
		return
	}

	var data any
	if len(bodyBytes) > 0 {
		if err := json.Unmarshal(bodyBytes, &data); err != nil {
			data = string(bodyBytes)
		}
	}

	resp := commondto.StandardResponse{
		Code: 0,
		Msg:  "success",
		Data: data,
	}
	c.JSON(http.StatusOK, resp)
}

func singleJoiningSlash(a, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	}
	return a + b
}

// httpToWebsocketURL converts http:// to ws:// and https:// to wss://
func httpToWebsocketURL(httpURL string) string {
	if strings.HasPrefix(httpURL, "https://") {
		return "wss://" + strings.TrimPrefix(httpURL, "https://")
	}
	if strings.HasPrefix(httpURL, "http://") {
		return "ws://" + strings.TrimPrefix(httpURL, "http://")
	}
	return httpURL
}

func readRequestBodyBytes(req *http.Request) ([]byte, error) {
	if req == nil || req.Body == nil {
		return nil, nil
	}

	bodyBytes, err := io.ReadAll(req.Body)
	if err != nil {
		return nil, err
	}
	req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	return bodyBytes, nil
}

func shouldDropProxyHeader(headerName string) bool {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(headerName)), "x-sico-") {
		return true
	}

	switch strings.ToLower(strings.TrimSpace(headerName)) {
	case "connection", "proxy-connection", "keep-alive",
		"proxy-authenticate", "proxy-authorization", "te",
		"trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func doPassthroughProxyRequest(
	ctx context.Context,
	req *http.Request,
	targetURL string,
	bodyBytes []byte,
) (*http.Response, error) {
	var bodyReader io.Reader
	if bodyBytes != nil {
		bodyReader = bytes.NewReader(bodyBytes)
	}

	proxyReq, err := http.NewRequestWithContext(ctx, req.Method, targetURL, bodyReader)
	if err != nil {
		return nil, err
	}

	for key, values := range req.Header {
		if shouldDropProxyHeader(key) || strings.EqualFold(key, "host") {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}

	client := &http.Client{Timeout: 60 * time.Second}
	return client.Do(proxyReq)
}

func writePassthroughProxyResponse(c *gin.Context, proxyResp *http.Response) error {
	for key, values := range proxyResp.Header {
		if shouldDropProxyHeader(key) {
			continue
		}
		for _, value := range values {
			c.Header(key, value)
		}
	}

	c.Status(proxyResp.StatusCode)
	_, err := io.Copy(c.Writer, proxyResp.Body)
	return err
}
