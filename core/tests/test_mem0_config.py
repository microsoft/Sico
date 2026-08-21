from pathlib import Path

from app.main import _resolve_mem0_config_path


def test_mem0_uses_canonical_config_path() -> None:
    path = _resolve_mem0_config_path()

    assert path == Path(__file__).resolve().parents[2] / "deploy" / "config" / "mem0" / "mem0_config.yaml"
