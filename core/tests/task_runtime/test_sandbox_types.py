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

from app.biz.task_runtime.sandbox_types import (
    INFRA_TO_OS,
    SANDBOX_OSES,
    SANDBOX_TYPES,
    InfraRequirement,
    SandboxOS,
    SandboxType,
    eligible_types_for_os,
    lease_type_from_sandbox_id,
    normalize_sandbox_hint,
    sandbox_for_requirement,
)


def test_sandbox_vocab_are_plain_str_values() -> None:
    # The enums subclass ``str`` so they drop into ``Literal[...]`` field
    # contracts and the gRPC boundary unchanged.
    assert SANDBOX_TYPES == ("emulator",)
    assert SANDBOX_OSES == ("android",)
    assert SandboxType.EMULATOR == "emulator"
    assert SandboxOS.ANDROID == "android"
    assert InfraRequirement.ANDROID == "sandbox.android"


def test_infra_maps_to_os_capability() -> None:
    # A skill requirement reserves against an OS, not a concrete type.
    assert INFRA_TO_OS == {
        "sandbox.android": "android",
    }
    assert sandbox_for_requirement("sandbox.android") == "android"
    assert sandbox_for_requirement("sandbox.unknown") is None


def test_infra_requirements_cover_every_os() -> None:
    # Drift guard: every OS must be declarable as a `sandbox.<os>` requirement,
    # so adding a SandboxOS forces a matching InfraRequirement/INFRA_TO_OS entry.
    assert set(INFRA_TO_OS.values()) == set(SANDBOX_OSES)
    for token, os in INFRA_TO_OS.items():
        assert token == f"sandbox.{os}"


def test_eligible_types_for_os() -> None:
    # Android by the emulator.
    assert eligible_types_for_os("android") == ("emulator",)


def test_lease_type_from_sandbox_id() -> None:
    assert lease_type_from_sandbox_id("emulator:res-123") == "emulator"
    # No recognizable type prefix -> None so callers fall back.
    assert lease_type_from_sandbox_id("memory-only") is None
    assert lease_type_from_sandbox_id("bogus:res") is None


@pytest.mark.parametrize(
    ("hint", "expected"),
    [
        ("android", "android"),
        ("Android", "android"),
        ("  sandbox.android  ", "android"),
        ("", ""),
        (None, ""),
        ("nonsense", ""),
        # Concrete sandbox types are internal-only and are NOT valid hints.
        ("emulator", ""),
    ],
)
def test_normalize_sandbox_hint(hint: str | None, expected: str) -> None:
    assert normalize_sandbox_hint(hint) == expected
