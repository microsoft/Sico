# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

"""VNC router - provides screen viewer for Android emulator devices via H264 WebSocket streaming."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

_LOGGER = logging.getLogger(__name__)

router = APIRouter(prefix="/vnc", tags=["VNC"])


class DeviceInfo(BaseModel):
    """Device info for screen viewer."""
    device_index: int
    adb_host: str
    adb_port: int
    view_url: str


@router.get("/view/{device_index}", response_class=HTMLResponse)
async def view_device(
    device_index: int,
    max_size: int = Query(1080, ge=480, le=1920, description="Max screen dimension"),
    bit_rate: int = Query(4_000_000, ge=500_000, le=20_000_000, description="Video bitrate"),
    max_fps: int = Query(30, ge=1, le=60, description="Max frames per second"),
):
    """
    Serve a screen viewer page for a specific device with touch/keyboard control.
    Uses H264 WebSocket streaming via the /devices/{index}/ws/h264 endpoint.
    """

    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>Android Emulator #{device_index}</title>
    <style>
        * {{ box-sizing: border-box; }}
        body {{
            margin: 0;
            padding: 20px;
            background: #1a1a2e;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            touch-action: none;
        }}
        #container {{
            text-align: center;
            color: #e2e8f0;
        }}
        h2 {{ margin: 0 0 12px 0; font-size: 18px; }}
        #videoContainer {{
            position: relative;
            display: inline-block;
            touch-action: none;
        }}
        #screen {{
            border: 2px solid #4f46e5;
            border-radius: 8px;
            background: #000;
            max-width: 100%;
            max-height: calc(100vh - 140px);
            touch-action: none;
            cursor: crosshair;
        }}
        .info {{
            margin-top: 12px;
            font-size: 12px;
            color: #a5b4fc;
        }}
        .status {{
            display: inline-block;
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 11px;
            margin-top: 6px;
        }}
        .status.connected {{ background: #22c55e; color: white; }}
        .status.connecting {{ background: #f59e0b; color: white; }}
        .status.error {{ background: #ef4444; color: white; }}
        .controls {{
            margin-top: 10px;
            display: flex;
            justify-content: center;
            gap: 6px;
            flex-wrap: wrap;
        }}
        .controls button {{
            background: #4f46e5;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
        }}
        .controls button:hover {{ background: #4338ca; }}
        .controls button:active {{ background: #3730a3; }}
    </style>
</head>
<body>
    <div id="container">
        <h2>📱 Emulator #{device_index}</h2>
        <div id="videoContainer">
            <video id="screen" autoplay muted playsinline></video>
        </div>
        <div class="info">
            <span id="resolution">--</span> | <span id="fps">--</span> | <span id="latency">--</span>
            <br>
            <span id="status" class="status connecting">Connecting...</span>
        </div>
        <div class="controls">
            <button onclick="sendBack()">◀ Back</button>
            <button onclick="sendHome()">⌂ Home</button>
            <button onclick="sendRecent()">☐ Recent</button>
            <button onclick="reconnect()">↻ Reconnect</button>
        </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/jmuxer@2.0.4/dist/jmuxer.min.js"></script>
    <script>
        const video = document.getElementById('screen');
        const videoContainer = document.getElementById('videoContainer');
        const statusEl = document.getElementById('status');
        const resolutionEl = document.getElementById('resolution');
        const fpsEl = document.getElementById('fps');
        const latencyEl = document.getElementById('latency');

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${{wsProtocol}}//${{window.location.host}}/api/v1/devices/{device_index}/ws/h264?max_size={max_size}&bit_rate={bit_rate}&max_fps={max_fps}`;

        let ws = null;
        let jmuxer = null;
        let deviceWidth = 0;
        let deviceHeight = 0;

        // Stats
        let frameCount = 0;
        let bytesReceived = 0;
        let lastStatsTime = Date.now();
        let lastFrameTime = 0;
        let latencySum = 0;
        let latencyCount = 0;

        // Touch tracking
        let activePointers = new Map();

        function updateStats() {{
            const now = Date.now();
            const elapsed = (now - lastStatsTime) / 1000;
            if (elapsed >= 1) {{
                const fps = Math.round(frameCount / elapsed);
                const avgLatency = latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0;
                fpsEl.textContent = fps + ' FPS';
                latencyEl.textContent = avgLatency + 'ms';
                frameCount = 0;
                bytesReceived = 0;
                latencySum = 0;
                latencyCount = 0;
                lastStatsTime = now;
            }}
        }}

        function getDeviceCoords(e) {{
            const rect = video.getBoundingClientRect();
            const scaleX = deviceWidth / rect.width;
            const scaleY = deviceHeight / rect.height;
            const x = Math.round((e.clientX - rect.left) * scaleX);
            const y = Math.round((e.clientY - rect.top) * scaleY);
            return {{ x: Math.max(0, Math.min(deviceWidth, x)), y: Math.max(0, Math.min(deviceHeight, y)) }};
        }}

        function sendTouch(action, x, y, pointerId = 0) {{
            if (ws && ws.readyState === WebSocket.OPEN) {{
                ws.send(JSON.stringify({{ type: 'touch', action, x, y, pointerId }}));
            }}
        }}

        function sendKey(action, keycode, metastate = 0) {{
            if (ws && ws.readyState === WebSocket.OPEN) {{
                ws.send(JSON.stringify({{ type: 'key', action, keycode, metastate }}));
            }}
        }}

        function sendBack() {{
            sendKey('down', 4); // KEYCODE_BACK
            setTimeout(() => sendKey('up', 4), 50);
        }}

        function sendHome() {{
            sendKey('down', 3); // KEYCODE_HOME
            setTimeout(() => sendKey('up', 3), 50);
        }}

        function sendRecent() {{
            sendKey('down', 187); // KEYCODE_APP_SWITCH
            setTimeout(() => sendKey('up', 187), 50);
        }}

        // Mouse events
        video.addEventListener('mousedown', (e) => {{
            e.preventDefault();
            const coords = getDeviceCoords(e);
            sendTouch('down', coords.x, coords.y);
            activePointers.set('mouse', coords);
        }});

        video.addEventListener('mousemove', (e) => {{
            if (activePointers.has('mouse')) {{
                e.preventDefault();
                const coords = getDeviceCoords(e);
                sendTouch('move', coords.x, coords.y);
            }}
        }});

        video.addEventListener('mouseup', (e) => {{
            if (activePointers.has('mouse')) {{
                e.preventDefault();
                const coords = getDeviceCoords(e);
                sendTouch('up', coords.x, coords.y);
                activePointers.delete('mouse');
            }}
        }});

        video.addEventListener('mouseleave', (e) => {{
            if (activePointers.has('mouse')) {{
                const coords = getDeviceCoords(e);
                sendTouch('up', coords.x, coords.y);
                activePointers.delete('mouse');
            }}
        }});

        // Touch events
        video.addEventListener('touchstart', (e) => {{
            e.preventDefault();
            for (const touch of e.changedTouches) {{
                const coords = getDeviceCoords(touch);
                sendTouch('down', coords.x, coords.y, touch.identifier);
                activePointers.set(touch.identifier, coords);
            }}
        }});

        video.addEventListener('touchmove', (e) => {{
            e.preventDefault();
            for (const touch of e.changedTouches) {{
                if (activePointers.has(touch.identifier)) {{
                    const coords = getDeviceCoords(touch);
                    sendTouch('move', coords.x, coords.y, touch.identifier);
                }}
            }}
        }});

        video.addEventListener('touchend', (e) => {{
            e.preventDefault();
            for (const touch of e.changedTouches) {{
                if (activePointers.has(touch.identifier)) {{
                    const coords = getDeviceCoords(touch);
                    sendTouch('up', coords.x, coords.y, touch.identifier);
                    activePointers.delete(touch.identifier);
                }}
            }}
        }});

        video.addEventListener('touchcancel', (e) => {{
            for (const touch of e.changedTouches) {{
                if (activePointers.has(touch.identifier)) {{
                    const coords = getDeviceCoords(touch);
                    sendTouch('up', coords.x, coords.y, touch.identifier);
                    activePointers.delete(touch.identifier);
                }}
            }}
        }});

        // Scroll events
        video.addEventListener('wheel', (e) => {{
            e.preventDefault();
            const coords = getDeviceCoords(e);
            const vScroll = e.deltaY > 0 ? -1 : 1;
            const hScroll = e.deltaX > 0 ? -1 : 1;
            if (ws && ws.readyState === WebSocket.OPEN) {{
                ws.send(JSON.stringify({{
                    type: 'scroll',
                    x: coords.x,
                    y: coords.y,
                    vScroll: e.deltaY !== 0 ? vScroll : 0,
                    hScroll: e.deltaX !== 0 ? hScroll : 0
                }}));
            }}
        }});

        // Keyboard events
        document.addEventListener('keydown', (e) => {{
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            let keycode = null;
            switch (e.key) {{
                case 'Backspace': keycode = 67; break;
                case 'Enter': keycode = 66; break;
                case 'Escape': keycode = 111; break;
                case 'ArrowUp': keycode = 19; break;
                case 'ArrowDown': keycode = 20; break;
                case 'ArrowLeft': keycode = 21; break;
                case 'ArrowRight': keycode = 22; break;
            }}

            if (keycode) {{
                e.preventDefault();
                sendKey('down', keycode);
            }} else if (e.key.length === 1) {{
                e.preventDefault();
                if (ws && ws.readyState === WebSocket.OPEN) {{
                    ws.send(JSON.stringify({{ type: 'text', text: e.key }}));
                }}
            }}
        }});

        document.addEventListener('keyup', (e) => {{
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            let keycode = null;
            switch (e.key) {{
                case 'Backspace': keycode = 67; break;
                case 'Enter': keycode = 66; break;
                case 'Escape': keycode = 111; break;
                case 'ArrowUp': keycode = 19; break;
                case 'ArrowDown': keycode = 20; break;
                case 'ArrowLeft': keycode = 21; break;
                case 'ArrowRight': keycode = 22; break;
            }}

            if (keycode) {{
                sendKey('up', keycode);
            }}
        }});

        // Disable context menu on video
        video.addEventListener('contextmenu', (e) => e.preventDefault());

        function connect() {{
            statusEl.textContent = 'Connecting...';
            statusEl.className = 'status connecting';

            jmuxer = new JMuxer({{
                node: 'screen',
                mode: 'video',
                flushingTime: 16,
                fps: {max_fps},
                debug: false,
            }});

            ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {{
                statusEl.textContent = 'Connected';
                statusEl.className = 'status connected';
                lastFrameTime = Date.now();
            }};

            ws.onclose = () => {{
                statusEl.textContent = 'Disconnected';
                statusEl.className = 'status error';
                cleanup();
                setTimeout(connect, 3000);
            }};

            ws.onerror = () => {{
                statusEl.textContent = 'Error';
                statusEl.className = 'status error';
            }};

            ws.onmessage = (event) => {{
                if (typeof event.data === 'string') {{
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'config') {{
                        deviceWidth = msg.width || 0;
                        deviceHeight = msg.height || 0;
                        if (deviceWidth > 0 && deviceHeight > 0) {{
                            resolutionEl.textContent = deviceWidth + 'x' + deviceHeight;
                        }}

                        // Feed SPS/PPS config data to jmuxer
                        if (msg.description) {{
                            const configData = Uint8Array.from(atob(msg.description), c => c.charCodeAt(0));
                            jmuxer.feed({{ video: configData }});
                        }}
                    }} else if (msg.type === 'error') {{
                        console.error('Server error:', msg.message);
                        statusEl.textContent = 'Error: ' + msg.message;
                        statusEl.className = 'status error';
                    }}
                }} else {{
                    const now = Date.now();
                    if (lastFrameTime > 0) {{
                        latencySum += now - lastFrameTime;
                        latencyCount++;
                    }}
                    lastFrameTime = now;

                    const data = new Uint8Array(event.data);
                    const payload = data.slice(9);

                    bytesReceived += payload.length;
                    frameCount++;

                    jmuxer.feed({{ video: payload }});
                    updateStats();
                }}
            }};
        }}

        function cleanup() {{
            if (jmuxer) {{ jmuxer.destroy(); jmuxer = null; }}
            if (ws) {{ ws.close(); ws = null; }}
            activePointers.clear();
        }}

        function reconnect() {{
            cleanup();
            connect();
        }}

        connect();
        window.addEventListener('beforeunload', cleanup);
    </script>
</body>
</html>"""
    return HTMLResponse(content=html)


@router.get("/devices")
def list_devices():
    """List all devices available for screen viewing."""
    from app.deps import get_mumu, get_device_index_map
    from app.settings import get_settings

    settings = get_settings()
    mumu = get_mumu(settings)
    device_map = get_device_index_map()

    device_map.refresh(mumu)
    devices = []

    for index in device_map.list_connected_indices():
        # Get serial from device_map (e.g., "127.0.0.1:16416")
        serial = device_map.get_serial(index)
        adb_host = "127.0.0.1"
        adb_port = 16384 + index  # MuMu default port range

        if serial and ":" in serial:
            parts = serial.rsplit(":", 1)
            adb_host = parts[0]
            try:
                adb_port = int(parts[1])
            except ValueError:
                pass

        devices.append({
            "device_index": index,
            "adb_host": adb_host,
            "adb_port": adb_port,
            "view_url": f"/vnc/view/{index}",
        })

    return {"devices": devices}
