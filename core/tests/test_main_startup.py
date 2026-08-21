import pytest

import app.main as main


@pytest.mark.asyncio
async def test_serve_validates_profiles_before_initializing_process_runtime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process_runtime_initialized = False

    def reject_profiles() -> None:
        raise RuntimeError("invalid profile catalog")

    def initialize_process_runtime() -> None:
        nonlocal process_runtime_initialized
        process_runtime_initialized = True

    monkeypatch.setattr(main, "default_agent_profile_resolver", reject_profiles)
    monkeypatch.setattr(main, "_initialize_process_runtime", initialize_process_runtime)

    with pytest.raises(RuntimeError, match="invalid profile catalog"):
        await main.serve()

    assert not process_runtime_initialized
