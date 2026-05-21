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

import pytest
from pydantic import ValidationError

from app.schemas import (
    AdbShellRequest,
    CloneEmulatorsRequest,
    CreateEmulatorsRequest,
    DeviceInfo,
    DownloadAppRequest,
    ListDevicesResponse,
    PackageRequest,
    StartEmulatorsBatchRequest,
    StartEmulatorRequest,
)


class TestDeviceInfo:
    def test_valid(self):
        d = DeviceInfo(index=0)
        assert d.index == 0

    def test_negative_index_rejected(self):
        with pytest.raises(ValidationError):
            DeviceInfo(index=-1)


class TestCreateEmulatorsRequest:
    def test_defaults(self):
        r = CreateEmulatorsRequest()
        assert r.count == 1
        assert r.start is True

    def test_max_count(self):
        r = CreateEmulatorsRequest(count=20)
        assert r.count == 20

    def test_over_max_rejected(self):
        with pytest.raises(ValidationError):
            CreateEmulatorsRequest(count=21)

    def test_zero_rejected(self):
        with pytest.raises(ValidationError):
            CreateEmulatorsRequest(count=0)


class TestCloneEmulatorsRequest:
    def test_valid(self):
        r = CloneEmulatorsRequest(count=5)
        assert r.count == 5

    def test_over_max_rejected(self):
        with pytest.raises(ValidationError):
            CloneEmulatorsRequest(count=21)


class TestStartEmulatorRequest:
    def test_optional_package(self):
        r = StartEmulatorRequest()
        assert r.package is None

    def test_with_package(self):
        r = StartEmulatorRequest(package="com.example.app")
        assert r.package == "com.example.app"


class TestStartEmulatorsBatchRequest:
    def test_valid(self):
        r = StartEmulatorsBatchRequest(indices=[0, 1, 2])
        assert r.indices == [0, 1, 2]

    def test_empty_rejected(self):
        with pytest.raises(ValidationError):
            StartEmulatorsBatchRequest(indices=[])

    def test_over_max_rejected(self):
        with pytest.raises(ValidationError):
            StartEmulatorsBatchRequest(indices=list(range(21)))


class TestPackageRequest:
    def test_valid(self):
        r = PackageRequest(package="com.example")
        assert r.package == "com.example"

    def test_empty_rejected(self):
        with pytest.raises(ValidationError):
            PackageRequest(package="")


class TestDownloadAppRequest:
    def test_valid(self):
        r = DownloadAppRequest(url="https://example.com/app.apk")
        assert r.url == "https://example.com/app.apk"

    def test_empty_rejected(self):
        with pytest.raises(ValidationError):
            DownloadAppRequest(url="")


class TestAdbShellRequest:
    def test_valid(self):
        r = AdbShellRequest(command="input tap 500 500")
        assert r.command == "input tap 500 500"

    def test_empty_rejected(self):
        with pytest.raises(ValidationError):
            AdbShellRequest(command="")


class TestListDevicesResponse:
    def test_empty_list(self):
        r = ListDevicesResponse(devices=[])
        assert r.devices == []

    def test_with_devices(self):
        r = ListDevicesResponse(devices=[DeviceInfo(index=0), DeviceInfo(index=1)])
        assert len(r.devices) == 2
