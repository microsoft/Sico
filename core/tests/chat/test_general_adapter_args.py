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

"""Dispatch ``args`` must carry only planner-supplied parameters.

The general adapter forwards ``args`` verbatim as the dispatch's user input.
Strict-schema skills (e.g. android-tester) reject unknown keys, so the adapter
must not inject any bookkeeping of its own (such as a positional index) into the
parameter dict.
"""

from __future__ import annotations

import json

from app.biz.chat.adapters.general.adapter import (
    GeneralAdapterError,
    GeneralAdapterOptions,
    PlannedTaskItem,
    ToolDescriptor,
    _build_task_spec,
)
from app.biz.task_runtime.skill_loader import CapabilityCard
from app.biz.task_runtime.models import SkillDispatch


def _options(**overrides) -> GeneralAdapterOptions:
    base = {
        "instructions": ["run the case"],
        "direct_tools": [ToolDescriptor(name="echo")],
    }
    base.update(overrides)
    return GeneralAdapterOptions.model_validate(base)


def _build(planned: PlannedTaskItem):
    options = _options()
    tool_index = {t.name: t for t in options.direct_tools}
    card = CapabilityCard(
        name="android-tester.run_android_test_case",
        skill_name="android-tester",
        action_name="run_android_test_case",
        parameters=[{"name": "case_name", "required": False}],
    )
    skill_index = {(card.skill_name, card.action_name): card}
    return _build_task_spec(2, "run the case", planned, options, tool_index, skill_index)


def test_skill_args_carry_only_planner_parameters() -> None:
    planned = PlannedTaskItem(
        title="android smoke",
        dispatch_type="skill",
        skill_name="android-tester",
        action_name="run_android_test_case",
        args_json=json.dumps({"case_name": "Copilot label smoke"}),
    )

    spec = _build(planned)

    assert isinstance(spec.dispatch, SkillDispatch)
    # No adapter bookkeeping (e.g. ``instruction_index``) may leak into skill args.
    assert spec.args == {"case_name": "Copilot label smoke"}
    assert "instruction_index" not in spec.args


def test_skill_args_default_empty_without_planner_input() -> None:
    planned = PlannedTaskItem(
        title="android smoke",
        dispatch_type="skill",
        skill_name="android-tester",
        action_name="run_android_test_case",
    )

    spec = _build(planned)

    assert spec.args == {}


def test_skill_args_reject_unknown_planner_parameters() -> None:
    planned = PlannedTaskItem(
        title="android smoke",
        dispatch_type="skill",
        skill_name="android-tester",
        action_name="run_android_test_case",
        args_json=json.dumps({"input_csv": "attachments/cases.csv"}),
    )

    try:
        _build(planned)
    except GeneralAdapterError as exc:
        assert exc.code == "general_planner_invalid_output"
        assert exc.details["unknown_args"] == ["input_csv"]
        assert exc.details["allowed_args"] == ["case_name"]
    else:  # pragma: no cover - defensive assertion style for clear failure output
        raise AssertionError("expected GeneralAdapterError")


def test_skill_args_reject_missing_required_planner_parameters() -> None:
    card = CapabilityCard(
        name="test-cases-rewrite.render_test_case_analysis_report",
        skill_name="test-cases-rewrite",
        action_name="render_test_case_analysis_report",
        parameters=[{"name": "analysis_jsonl", "required": True}, {"name": "infra_json", "required": False}],
    )
    options = _options()
    tool_index = {t.name: t for t in options.direct_tools}
    skill_index = {(card.skill_name, card.action_name): card}
    planned = PlannedTaskItem(
        title="render report",
        dispatch_type="skill",
        skill_name="test-cases-rewrite",
        action_name="render_test_case_analysis_report",
        args_json=json.dumps({"infra_json": "data/infra.json"}),
    )

    try:
        _build_task_spec(1, "render report", planned, options, tool_index, skill_index)
    except GeneralAdapterError as exc:
        assert exc.code == "general_planner_invalid_output"
        assert exc.details["missing_args"] == ["analysis_jsonl"]
    else:  # pragma: no cover - defensive assertion style for clear failure output
        raise AssertionError("expected GeneralAdapterError")
