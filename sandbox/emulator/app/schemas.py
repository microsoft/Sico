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

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class DeviceInfo(BaseModel):
    index: int = Field(..., ge=0)


class ListDevicesResponse(BaseModel):
    devices: list[DeviceInfo]


class CreateEmulatorsRequest(BaseModel):
    count: int = Field(1, ge=1, le=20)
    start: bool = True


class CloneEmulatorsRequest(BaseModel):
    count: int = Field(1, ge=1, le=20)


class StartEmulatorRequest(BaseModel):
    package: Optional[str] = None


class StartEmulatorsBatchRequest(BaseModel):
    indices: list[int] = Field(..., min_length=1, max_length=20)
    package: Optional[str] = None
    max_parallel: Optional[int] = Field(default=None, ge=1, le=20)


class PackageRequest(BaseModel):
    package: str = Field(..., min_length=1)


class DownloadAppRequest(BaseModel):
    url: str = Field(..., min_length=1)


class AdbShellRequest(BaseModel):
    """Generic ADB shell command request.

    Examples:
        - {"command": "input tap 500 500"}
        - {"command": "input swipe 100 100 500 500 300"}
        - {"command": "input text hello"}
        - {"command": "input keyevent 66"}
        - {"command": "pm list packages"}
    """
    command: str = Field(..., min_length=1, description="ADB shell command to execute")
