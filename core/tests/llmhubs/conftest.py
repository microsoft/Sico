from collections.abc import Callable

import pytest

from app.llmhubs.types import ModelRegistryEntry


@pytest.fixture()
def install_test_hub(monkeypatch: pytest.MonkeyPatch) -> Callable[[ModelRegistryEntry], None]:
    def _install(entry: ModelRegistryEntry) -> None:
        import app.llmhubs as llmhubs_pkg
        from app.llmhubs.hub import LLMHub

        hub = object.__new__(LLMHub)
        hub._builtin = {entry.model_key: entry}
        hub._dynamic = {}
        hub._default_model_key = entry.model_key
        monkeypatch.setattr(llmhubs_pkg, "_DEFAULT_HUB", hub, raising=False)

    return _install
