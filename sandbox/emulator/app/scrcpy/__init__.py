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

"""
Scrcpy integration for H264 video streaming with control support.

This module provides an interface to stream H264 video and send
control commands to Android devices using scrcpy-server v2.7.

Features:
- H264 hardware encoding via MediaCodec (low CPU, low latency ~35ms)
- Touch, keyboard, and scroll control
- No time limit (unlike screenrecord)

Usage:
    client = ScrcpyClient(adb_path, serial)
    await client.start()
    try:
        async for packet in client.video_stream():
            # Handle video packet
            pass
    finally:
        await client.stop()
"""

from .client import (
    ScrcpyClient,
    ScrcpyConfig,
    VideoPacket,
    VideoCodec,
    TouchAction,
    KeyAction,
    ControlMessageType,
)

__all__ = [
    "ScrcpyClient",
    "ScrcpyConfig",
    "VideoPacket",
    "VideoCodec",
    "TouchAction",
    "KeyAction",
    "ControlMessageType",
]
