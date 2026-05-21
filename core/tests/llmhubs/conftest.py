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
