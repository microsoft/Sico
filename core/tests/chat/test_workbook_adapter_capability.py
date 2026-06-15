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

from app.biz.chat.adapters.workbook.adapter import (
    WorkbookAdapterOptions,
    _resolve_capability,
)
from app.biz.task_runtime.skill_loader import CapabilityCard


def _android_card() -> CapabilityCard:
    return CapabilityCard(
        name="android-test.run",
        skill_name="android-test",
        action_name="run",
        infra_requirements=["sandbox.android"],
    )


def test_resolve_capability_matches_os_hint() -> None:
    # The card declares the "android" OS capability; a matching OS hint selects it.
    card = _android_card()
    assert card.requires_sandbox == "android"

    options = WorkbookAdapterOptions(skill_name="android-test", required_sandbox="android")
    assert options.required_sandbox == "android"

    assert _resolve_capability((card,), options) is card


def test_resolve_capability_unknown_os_normalizes_to_empty() -> None:
    # An unrecognized OS hint normalizes to "" via the field validator, so the
    # mismatch guard does not fire and the card is selected by skill_name alone.
    card = _android_card()
    options = WorkbookAdapterOptions(skill_name="android-test", required_sandbox="bogus_os")
    assert options.required_sandbox == ""
    assert _resolve_capability((card,), options) is card
