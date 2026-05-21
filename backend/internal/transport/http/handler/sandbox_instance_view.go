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
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"sico-backend/internal/shared/apperr"
	sandboxbiz "sico-backend/internal/biz/sandbox"
	"sico-backend/internal/biz/sandbox/impl"
	"sico-backend/internal/enum"
	"sico-backend/internal/errcode"
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
	emu, ok := prov.(*impl.EmulatorProvider)
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("invalid emulator provider"))
		return
	}

	baseURL, deviceID, err := emu.ParseEmulatorResourceIDForProxy(lease.ResourceID)
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

// resourceEmulatorHTMLTemplate is the HTML+JS for the per-resource emulator viewer.
// It contains a single %q placeholder for the WebSocket path and %% literals for CSS.
const resourceEmulatorHTMLTemplate = `<!doctype html>
<html>
<head>
	<meta charset="utf-8"/>
	<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"/>
	<title>Emulator Live View</title>
	<style>
		*{margin:0;padding:0;box-sizing:border-box}
		html,body{overflow:hidden;height:100vh}
		body{background:#fff;display:flex;flex-direction:column;` +
	`justify-content:center;align-items:center;touch-action:none}
		#videoContainer{position:relative;display:inline-block;touch-action:none}
		video{max-width:100%%;max-height:calc(100vh - 48px);display:block;` +
	`border:2px solid #4f46e5;border-radius:8px;background:#fff;` +
	`touch-action:none;cursor:crosshair}
		#playOverlay{display:none;position:absolute;top:0;left:0;right:0;bottom:0;` +
	`background:rgba(0,0,0,.7);border-radius:8px;cursor:pointer;` +
	`align-items:center;justify-content:center;z-index:10}
		#playOverlay .play-btn{font-size:48px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.5)}
		#status{position:fixed;top:8px;left:8px;color:#334155;` +
	`font-size:11px;font-family:ui-sans-serif,system-ui;z-index:20}
		.controls{display:flex;justify-content:center;gap:6px;margin-top:8px}
		.controls button{background:#4f46e5;color:#fff;border:none;padding:6px 14px;` +
	`border-radius:6px;cursor:pointer;font-size:12px;font-family:ui-sans-serif,system-ui}
		.controls button:hover{background:#4338ca}
		.controls button:active{background:#3730a3}
	</style>
</head>
<body>
	<div id="status"></div>
	<div id="videoContainer">
		<video id="screen" autoplay muted playsinline></video>
		<div id="playOverlay" onclick="startPlay()">
			<div style="text-align:center">
				<div class="play-btn">▶</div>
			</div>
		</div>
	</div>
	<div class="controls">
		<button onclick="sendBack()">◀ Back</button>
		<button onclick="sendHome()">⌂ Home</button>
		<button onclick="sendRecent()">☐ Recent</button>
	</div>
	<script src="/js/jmuxer.min.js"></script>
	<script>
		const wsPath = %q;
		const video = document.getElementById('screen');
		const playOverlay = document.getElementById('playOverlay');
		const statusEl = document.getElementById('status');

		let ws = null;
		let jmuxer = null;
		let deviceWidth = 0, deviceHeight = 0;
		let reconnectAttempts = 0;
		let playAttempted = false;
		const MAX_RECONNECT = 8;

		function connect() {
			statusEl.textContent = 'Connecting...';

			jmuxer = new JMuxer({
				node: 'screen',
				mode: 'video',
				flushingTime: 16,
				fps: 30,
				debug: false,
			});

			const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
			ws = new WebSocket(proto + '//' + location.host + wsPath);
			ws.binaryType = 'arraybuffer';

			ws.onopen = () => {
				statusEl.textContent = '';
				reconnectAttempts = 0;
				playAttempted = false;
			};

			ws.onclose = () => {
				statusEl.textContent = 'Reconnecting...';
				cleanup();
				if (reconnectAttempts < MAX_RECONNECT) {
					reconnectAttempts++;
					setTimeout(connect, 1000 * Math.min(reconnectAttempts, 5));
				} else {
					statusEl.textContent = 'Connection lost. Please refresh.';
				}
			};

			ws.onerror = () => { statusEl.textContent = 'WebSocket error.'; };

			ws.onmessage = (event) => {
				if (typeof event.data === 'string') {
					const msg = JSON.parse(event.data);
					if (msg.type === 'config') {
						deviceWidth = msg.width || 0;
						deviceHeight = msg.height || 0;
						if (msg.description) {
							const configData = Uint8Array.from(
								atob(msg.description), c => c.charCodeAt(0));
							jmuxer.feed({ video: configData });
						}
					}
				} else {
					const data = new Uint8Array(event.data);
					if (data.length < 9) return;
					const payload = data.subarray(9);
					jmuxer.feed({ video: payload });
					if (!playAttempted && video.paused) {
						playAttempted = true;
						video.play().catch(() => { playOverlay.style.display = 'flex'; });
					}
				}
			};
		}

		function cleanup() {
			if (jmuxer) { try { jmuxer.destroy(); } catch(e){} jmuxer = null; }
			if (ws) { try { ws.close(); } catch(e){} ws = null; }
		}

		function tryAutoplay() {
			const p = video.play();
			if (p !== undefined) {
				p.catch(() => { playOverlay.style.display = 'flex'; });
			}
		}

		function startPlay() {
			playOverlay.style.display = 'none';
			video.play().catch(e => console.warn('Play failed:', e));
		}

		// --- Input handlers (touch/mouse/keyboard/scroll) ---
		let activePointers = new Map();

		function getDeviceCoords(e) {
			const rect = video.getBoundingClientRect();
			if (!deviceWidth || !deviceHeight || !rect.width || !rect.height) return null;
			const scaleX = deviceWidth / rect.width;
			const scaleY = deviceHeight / rect.height;
			const x = Math.round((e.clientX - rect.left) * scaleX);
			const y = Math.round((e.clientY - rect.top) * scaleY);
			return { x: Math.max(0, Math.min(deviceWidth, x)), y: Math.max(0, Math.min(deviceHeight, y)) };
		}

		function sendControl(msg) {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(msg));
			}
		}

		function sendTouch(action, x, y, pointerId) {
			sendControl({ type: 'touch', action, x, y, pointerId: pointerId || 0 });
		}

		function sendKey(action, keycode) {
			sendControl({ type: 'key', action, keycode });
		}

		function sendBack() {
			sendKey('down', 4); setTimeout(() => sendKey('up', 4), 50);
		}
		function sendHome() {
			sendKey('down', 3); setTimeout(() => sendKey('up', 3), 50);
		}
		function sendRecent() {
			sendKey('down', 187); setTimeout(() => sendKey('up', 187), 50);
		}

		// Mouse events
		video.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const c = getDeviceCoords(e);
			if (!c) return;
			sendTouch('down', c.x, c.y);
			activePointers.set('mouse', c);
		});
		video.addEventListener('mousemove', (e) => {
			if (activePointers.has('mouse')) {
				e.preventDefault();
				const c = getDeviceCoords(e);
				if (!c) return;
				sendTouch('move', c.x, c.y);
			}
		});
		video.addEventListener('mouseup', (e) => {
			if (activePointers.has('mouse')) {
				e.preventDefault();
				const c = getDeviceCoords(e);
				if (!c) { activePointers.delete('mouse'); return; }
				sendTouch('up', c.x, c.y);
				activePointers.delete('mouse');
			}
		});
		video.addEventListener('mouseleave', (e) => {
			if (activePointers.has('mouse')) {
				const c = getDeviceCoords(e);
				if (c) sendTouch('up', c.x, c.y);
				activePointers.delete('mouse');
			}
		});

		// Touch events
		video.addEventListener('touchstart', (e) => {
			e.preventDefault();
			for (const t of e.changedTouches) {
				const c = getDeviceCoords(t);
				if (!c) continue;
				sendTouch('down', c.x, c.y, t.identifier);
				activePointers.set(t.identifier, c);
			}
		});
		video.addEventListener('touchmove', (e) => {
			e.preventDefault();
			for (const t of e.changedTouches) {
				if (activePointers.has(t.identifier)) {
					const c = getDeviceCoords(t);
					if (!c) continue;
					sendTouch('move', c.x, c.y, t.identifier);
				}
			}
		});
		video.addEventListener('touchend', (e) => {
			e.preventDefault();
			for (const t of e.changedTouches) {
				if (activePointers.has(t.identifier)) {
					const c = getDeviceCoords(t);
					if (c) sendTouch('up', c.x, c.y, t.identifier);
					activePointers.delete(t.identifier);
				}
			}
		});
		video.addEventListener('touchcancel', (e) => {
			for (const t of e.changedTouches) {
				if (activePointers.has(t.identifier)) {
					const c = getDeviceCoords(t);
					if (c) sendTouch('up', c.x, c.y, t.identifier);
					activePointers.delete(t.identifier);
				}
			}
		});

		// Scroll/wheel events — intercept at document level to prevent macOS
		// trackpad two-finger swipe from triggering browser back/forward
		// navigation (which destroys the iframe and kills the WebSocket).
		// NOTE: scroll messages are NOT forwarded to the emulator via this
		// WebSocket because sending bursts of messages on the H264 fan-out
		// hub connection causes abnormal disconnection (close code 1006).
		// Touch, click, and keyboard events work fine (low-frequency).
		document.addEventListener('wheel', (e) => {
			e.preventDefault();
			e.stopPropagation();
		}, { passive: false });

		// Keyboard events
		document.addEventListener('keydown', (e) => {
			if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
			let keycode = null;
			switch (e.key) {
				case 'Backspace': keycode = 67; break;
				case 'Enter': keycode = 66; break;
				case 'Escape': keycode = 111; break;
				case 'ArrowUp': keycode = 19; break;
				case 'ArrowDown': keycode = 20; break;
				case 'ArrowLeft': keycode = 21; break;
				case 'ArrowRight': keycode = 22; break;
			}
			if (keycode) { e.preventDefault(); sendKey('down', keycode); }
			else if (e.key.length === 1) { e.preventDefault(); sendControl({ type: 'text', text: e.key }); }
		});
		document.addEventListener('keyup', (e) => {
			if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
			let keycode = null;
			switch (e.key) {
				case 'Backspace': keycode = 67; break;
				case 'Enter': keycode = 66; break;
				case 'Escape': keycode = 111; break;
				case 'ArrowUp': keycode = 19; break;
				case 'ArrowDown': keycode = 20; break;
				case 'ArrowLeft': keycode = 21; break;
				case 'ArrowRight': keycode = 22; break;
			}
			if (keycode) sendKey('up', keycode);
		});

		// Disable context menu on video
		video.addEventListener('contextmenu', (e) => e.preventDefault());

		connect();
		video.addEventListener('loadeddata', tryAutoplay, { once: true });
		window.addEventListener('beforeunload', cleanup);
	</script>
</body>
</html>`

// ResourceEmulatorUI renders a backend-owned HTML viewer for a specific emulator resource.
// Uses JMuxer + H264 WebSocket streaming (same approach as emulator's /vnc/view page).
func ResourceEmulatorUI(c *gin.Context) {
	rid := resolveResourceRid(c)
	if rid == "" {
		invalidParamRequestResponse(c, "rid is required")
		return
	}

	wsPath := fmt.Sprintf("/api/sico/sandbox/resources/emulator/%s/ws/h264", url.PathEscape(rid))
	c.Header("Content-Type", "text/html; charset=utf-8")
	html := fmt.Sprintf(resourceEmulatorHTMLTemplate, wsPath)

	c.String(http.StatusOK, "%s", html)
}

// ResourceEmulatorProxy reverse-proxies REST API requests to the emulator service.
// Route: /api/sico/sandbox/resources/emulator/:rid/api/*path
// This allows the HTTPS dashboard to call emulator APIs (like port-forward)
// without mixed-content or CORS issues.
func ResourceEmulatorProxy(c *gin.Context) {
	rid := resolveResourceRid(c)
	if rid == "" {
		invalidParamRequestResponse(c, "rid is required")
		return
	}

	implSvc, ok := mustGetSandboxImplServiceFromDefault(c)
	if !ok {
		return
	}

	resource, err := resolveResourceByHash(reqctx(c), implSvc.Pool, enum.SandboxTypeEmulator.String(), rid)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	prov, ok := implSvc.Pool.GetProvider(enum.SandboxTypeEmulator.String())
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("emulator provider not available"))
		return
	}
	emu, ok := prov.(*impl.EmulatorProvider)
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("invalid emulator provider"))
		return
	}

	baseURL, _, err := emu.ParseEmulatorResourceIDForProxy(resource.ResourceID)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	target, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	path := c.Param("path")
	if path == "" {
		path = "/"
	}
	upstreamPath := "/api" + path

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		internalServerErrorResponse(c, fmt.Errorf("emulator proxy error: %v", e))
	}

	origDirector := proxy.Director
	proxy.Director = func(r *http.Request) {
		origDirector(r)
		r.URL.Path = singleJoiningSlash(target.Path, upstreamPath)
		r.Host = target.Host
		r.URL.RawQuery = c.Request.URL.RawQuery
		// Strip auth headers
		for k := range r.Header {
			if strings.HasPrefix(strings.ToLower(k), "x-sico-") {
				r.Header.Del(k)
			}
		}
	}

	proxy.ServeHTTP(c.Writer, c.Request)
}

// ResourceEmulatorH264WS proxies the emulator H264 WebSocket stream for a
// specific resource.  This is a simple 1:1 bidirectional WebSocket proxy —
// the emulator's H264DeviceHub guarantees at most one scrcpy process per
// device regardless of how many upstream connections it receives.
func ResourceEmulatorH264WS(c *gin.Context) {
	rid := resolveResourceRid(c)
	if rid == "" {
		invalidParamRequestResponse(c, "rid is required")
		return
	}

	implSvc, ok := mustGetSandboxImplServiceFromDefault(c)
	if !ok {
		return
	}

	resource, err := resolveResourceByHash(reqctx(c), implSvc.Pool, enum.SandboxTypeEmulator.String(), rid)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	prov, ok := implSvc.Pool.GetProvider(enum.SandboxTypeEmulator.String())
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("emulator provider not available"))
		return
	}
	emu, ok := prov.(*impl.EmulatorProvider)
	if !ok {
		internalServerErrorResponse(c, fmt.Errorf("invalid emulator provider"))
		return
	}

	baseURL, deviceID, err := emu.ParseEmulatorResourceIDForProxy(resource.ResourceID)
	if err != nil {
		internalServerErrorResponse(c, err)
		return
	}

	query := c.Request.URL.Query()
	query.Del("rid")
	encodedQuery := query.Encode()
	if strings.TrimSpace(encodedQuery) == "" {
		encodedQuery = "max_size=900&bit_rate=4000000&max_fps=24"
	}
	wsBaseURL := httpToWebsocketURL(strings.TrimRight(baseURL, "/"))
	upstream := fmt.Sprintf("%s/api/v1/devices/%s/ws/h264?%s", wsBaseURL, url.PathEscape(deviceID), encodedQuery)

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

	// Dial upstream emulator WebSocket
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	upstreamConn, _, err := dialer.DialContext(reqctx(c), upstream, nil)
	if err != nil {
		log.Printf("[Emulator WS Proxy] Failed to dial upstream %s: %v", upstream, err)
		_ = clientConn.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":"upstream dial failed"}`))
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
		if emulatorProv, ok := provider.(*impl.EmulatorProvider); ok {
			baseURL, deviceID, err := emulatorProv.ParseEmulatorResourceIDForProxy(lease.ResourceID)
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

func resolveResourceRid(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if rid := strings.TrimSpace(c.Param("rid")); rid != "" {
		return rid
	}
	if rid := strings.TrimSpace(c.Query("rid")); rid != "" {
		return rid
	}
	if ref := strings.TrimSpace(c.Request.Referer()); ref != "" {
		if refURL, err := url.Parse(ref); err == nil {
			if rid := strings.TrimSpace(refURL.Query().Get("rid")); rid != "" {
				return rid
			}
		}
	}
	return ""
}

func resolveResourceByHash(ctx context.Context, pool *impl.Pool, sandboxType, rid string) (*impl.Resource, error) {
	if pool == nil {
		return nil, apperr.New(errcode.SandboxProviderUnavailable, "sandbox provider unavailable")
	}
	return pool.ResolveResourceByHash(ctx, sandboxType, rid)
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
