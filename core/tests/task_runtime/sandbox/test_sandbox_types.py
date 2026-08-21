from __future__ import annotations

import pytest

from app.biz.task_runtime.sandbox.types import (
    INFRA_TO_OS,
    SANDBOX_OSES,
    SANDBOX_TYPES,
    TYPE_OS,
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
    assert SANDBOX_TYPES == ("emulator", "wincua", "aio", "physical")
    assert SANDBOX_OSES == ("windows", "macos", "ios", "android", "linux")
    assert SandboxType.EMULATOR == "emulator"
    assert SandboxOS.WINDOWS == "windows"
    assert InfraRequirement.ANDROID == "sandbox.android"


def test_infra_maps_to_os_capability() -> None:
    # A skill requirement reserves against an OS, not a concrete type.
    assert INFRA_TO_OS == {
        "sandbox.android": "android",
        "sandbox.windows": "windows",
        "sandbox.macos": "macos",
        "sandbox.ios": "ios",
        "sandbox.linux": "linux",
    }
    assert sandbox_for_requirement("sandbox.android") == "android"
    assert sandbox_for_requirement("sandbox.macos") == "macos"
    assert sandbox_for_requirement("sandbox.unknown") is None


def test_infra_requirements_cover_every_os() -> None:
    # Drift guard: every OS must be declarable as a `sandbox.<os>` requirement,
    # so adding a SandboxOS forces a matching InfraRequirement/INFRA_TO_OS entry.
    assert set(INFRA_TO_OS.values()) == set(SANDBOX_OSES)
    for token, os in INFRA_TO_OS.items():
        assert token == f"sandbox.{os}"


def test_eligible_types_for_os() -> None:
    assert eligible_types_for_os("windows") == ("wincua", "physical")
    assert eligible_types_for_os("android") == ("emulator", "physical")
    assert eligible_types_for_os("macos") == ("physical",)
    assert eligible_types_for_os("ios") == ("physical",)
    assert "physical" not in TYPE_OS


def test_lease_type_from_sandbox_id() -> None:
    assert lease_type_from_sandbox_id("wincua:res-123") == "wincua"
    assert lease_type_from_sandbox_id("physical:abc|dev") == "physical"
    # No recognizable type prefix -> None so callers fall back.
    assert lease_type_from_sandbox_id("memory-only") is None
    assert lease_type_from_sandbox_id("bogus:res") is None


@pytest.mark.parametrize(
    ("hint", "expected"),
    [
        ("android", "android"),
        ("Android", "android"),
        ("  sandbox.android  ", "android"),
        ("windows", "windows"),
        ("sandbox.windows", "windows"),
        ("macos", "macos"),
        ("ios", "ios"),
        ("linux", "linux"),
        ("", ""),
        (None, ""),
        ("nonsense", ""),
        # Concrete sandbox types are internal-only and are NOT valid hints.
        ("wincua", ""),
        ("emulator", ""),
        ("aio", ""),
    ],
)
def test_normalize_sandbox_hint(hint: str | None, expected: str) -> None:
    assert normalize_sandbox_hint(hint) == expected
