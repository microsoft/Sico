from pathlib import Path

import pytest

import app.experiences.integrations  # noqa: F401  -- ensures the default parser is registered
from app.experiences.integrations import dw_registry
from app.experiences.integrations.default_parser import parse_trajectory
from app.experiences.integrations.dw_registry import (
    _REGISTRY,
    get_dw_parser,
    register_default_parser,
    register_dw_parser,
)


@pytest.fixture(autouse=True)
def _restore_registry():
    snapshot = dict(_REGISTRY)
    default_snapshot = dw_registry._DEFAULT_PARSER
    try:
        yield
    finally:
        _REGISTRY.clear()
        _REGISTRY.update(snapshot)
        register_default_parser(default_snapshot)


def test_register_and_lookup_roundtrip() -> None:
    def dummy_parser(run_dir, run, result):
        return []

    register_dw_parser("dummy-skill", dummy_parser)
    assert get_dw_parser("dummy-skill") is dummy_parser


def test_get_unknown_skill_falls_back_to_default() -> None:
    # Any skill without a custom parser resolves to the default — so every DW
    # learns out of the box.
    assert get_dw_parser("not-registered") is parse_trajectory


def test_custom_parser_takes_precedence_over_default() -> None:
    def custom(run_dir, run, result):
        return []

    register_dw_parser("special-skill", custom)
    assert get_dw_parser("special-skill") is custom


def test_get_none_skill_returns_none() -> None:
    assert get_dw_parser(None) is None


def test_get_empty_string_skill_returns_none() -> None:
    assert get_dw_parser("") is None


def test_default_parser_returns_none_when_unset() -> None:
    register_default_parser(None)
    assert get_dw_parser("not-registered") is None


def test_register_empty_skill_rejected() -> None:
    with pytest.raises(ValueError):
        register_dw_parser("", lambda run_dir, run, result: [])


def test_re_register_overwrites() -> None:
    def first(run_dir: Path, run, result):
        return []

    def second(run_dir: Path, run, result):
        return []

    register_dw_parser("skill", first)
    register_dw_parser("skill", second)
    assert get_dw_parser("skill") is second
