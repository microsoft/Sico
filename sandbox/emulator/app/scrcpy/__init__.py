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
