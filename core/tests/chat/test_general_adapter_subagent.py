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

"""Sub-agent capability scoping in the general adapter.

The sub-agent must only ever reach capabilities the chat layer supplied in the
batch — never the global skill registry. These tests pin both the explicit
planner grant and the catalogue-bounded fallback.
"""

from __future__ import annotations

from app.biz.chat.adapters.general.adapter import (
    GeneralAdapterError,
    GeneralAdapterOptions,
    PlannedTaskItem,
    ToolDescriptor,
    _build_task_spec,
    _catalogue_capability_names,
)
from app.biz.task_runtime.skill_loader import CapabilityCard
from app.biz.task_runtime.models import SubAgentDispatch


def _options(**overrides) -> GeneralAdapterOptions:
    base = {
        "instructions": ["do the thing"],
        "direct_tools": [ToolDescriptor(name="run_command"), ToolDescriptor(name="echo")],
        "allow_sub_agent": True,
    }
    base.update(overrides)
    return GeneralAdapterOptions.model_validate(base)


def _spec_for(planned: PlannedTaskItem, options: GeneralAdapterOptions) -> SubAgentDispatch:
    tool_index = {t.name: t for t in options.direct_tools}
    skill_index = _skill_index()
    spec = _build_task_spec(1, "do the thing", planned, options, tool_index, skill_index)
    assert isinstance(spec.dispatch, SubAgentDispatch)
    return spec.dispatch


def _skill_index() -> dict[tuple[str, str], CapabilityCard]:
    card = CapabilityCard(name="run_testcase.execute", skill_name="run_testcase", action_name="execute")
    return {(card.skill_name, card.action_name): card}


def test_catalogue_capability_names_bounds_to_supplied_tools_and_skills() -> None:
    names = _catalogue_capability_names(_options(), _skill_index().values())

    # Tools are bare names; skills are skill.action; action-less skills are skipped.
    assert names == ["run_command", "echo", "run_testcase.execute"]


def test_catalogue_capability_names_dedupes_preserving_order() -> None:
    options = _options(
        direct_tools=[ToolDescriptor(name="echo"), ToolDescriptor(name="echo")],
    )

    assert _catalogue_capability_names(options, []) == ["echo"]


def test_sub_agent_inherits_full_catalogue_when_planner_grants_none() -> None:
    options = _options()
    planned = PlannedTaskItem(title="loop", dispatch_type="sub_agent", sub_agent_capabilities=[])

    dispatch = _spec_for(planned, options)

    assert dispatch.capabilities == ["run_command", "echo", "run_testcase.execute"]


def test_sub_agent_respects_explicit_capability_grant() -> None:
    options = _options()
    planned = PlannedTaskItem(
        title="loop",
        dispatch_type="sub_agent",
        sub_agent_capabilities=["run_testcase.execute"],
    )

    dispatch = _spec_for(planned, options)

    # Explicit (narrower) grant wins; the rest of the catalogue is NOT added.
    assert dispatch.capabilities == ["run_testcase.execute"]


def test_sub_agent_rejects_explicit_capability_outside_catalogue() -> None:
    options = _options()
    planned = PlannedTaskItem(
        title="loop",
        dispatch_type="sub_agent",
        # `secret_skill.exfiltrate` exists nowhere in this batch's catalogue; even
        # if it were a real skill in the global registry, the adapter must refuse
        # to widen the sub-agent's reach beyond what the caller declared.
        sub_agent_capabilities=["run_testcase.execute", "secret_skill.exfiltrate"],
    )

    tool_index = {t.name: t for t in options.direct_tools}
    skill_index = _skill_index()
    try:
        _build_task_spec(1, "do the thing", planned, options, tool_index, skill_index)
    except GeneralAdapterError as exc:
        assert exc.code == "general_planner_invalid_output"
        assert exc.details["unknown_capabilities"] == ["secret_skill.exfiltrate"]
    else:  # pragma: no cover - the call must raise
        raise AssertionError("expected GeneralAdapterError for out-of-catalogue capability")
