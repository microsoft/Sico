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

from app.biz.task_runtime.models import ErrorClass, SkillDispatch, SubAgentDispatch, ToolDispatch, TaskSpec
from app.biz.task_runtime.policy import _resolve_policy, validate_execution_mode


def _tool_task(**kwargs) -> TaskSpec:
    return TaskSpec(task_id="t", title="T", dispatch=ToolDispatch(tool_name="echo"), **kwargs)


def _skill_task(**kwargs) -> TaskSpec:
    return TaskSpec(task_id="t", title="T", dispatch=SkillDispatch(skill_name="mock"), **kwargs)


def _sub_agent_task(**kwargs) -> TaskSpec:
    return TaskSpec(task_id="t", title="T", dispatch=SubAgentDispatch(), **kwargs)


# ---------------------------------------------------------------------------
# _resolve_policy
# ---------------------------------------------------------------------------


def test_plain_tool_runs_in_process_with_default_retry() -> None:
    policy = _resolve_policy(_tool_task())

    assert policy.executor == "in_process"
    assert policy.retry.max_attempts == 1
    assert policy.trust_level == "platform_signed"


def test_skill_dispatch_uses_command_backend_without_skill_runtime_retry() -> None:
    policy = _resolve_policy(_skill_task())

    assert policy.executor == "command_backend"
    assert policy.retry.max_attempts == 2
    assert ErrorClass.TIMEOUT in policy.retry.retry_on
    assert ErrorClass.SKILL_RUNTIME not in policy.retry.retry_on


def test_required_sandbox_forces_command_backend() -> None:
    policy = _resolve_policy(_tool_task(required_sandbox="android"))

    assert policy.executor == "command_backend"
    assert policy.retry.max_attempts == 2


def test_sub_agent_without_sandbox_runs_in_process() -> None:
    # Only skills and sandbox-bound tasks need the command backend.
    policy = _resolve_policy(_sub_agent_task())

    assert policy.executor == "in_process"
    assert policy.retry.max_attempts == 1


def test_timeout_is_read_from_args() -> None:
    policy = _resolve_policy(_tool_task(args={"timeout_seconds": 120}))

    assert policy.timeout_seconds == 120


def test_timeout_defaults_to_600() -> None:
    policy = _resolve_policy(_tool_task())

    assert policy.timeout_seconds == 600


def test_falsy_timeout_arg_falls_back_to_default() -> None:
    policy = _resolve_policy(_tool_task(args={"timeout_seconds": 0}))

    assert policy.timeout_seconds == 600


# ---------------------------------------------------------------------------
# validate_execution_mode
# ---------------------------------------------------------------------------


def test_validate_rejects_sandbox_task_run_in_process() -> None:
    task = _tool_task(required_sandbox="android")
    in_process = _resolve_policy(_tool_task())  # executor == "in_process"

    assert validate_execution_mode(task, in_process) == ErrorClass.POLICY_DENY


def test_validate_allows_sandbox_task_on_command_backend() -> None:
    task = _tool_task(required_sandbox="android")
    policy = _resolve_policy(task)  # executor == "command_backend"

    assert validate_execution_mode(task, policy) is None


def test_validate_allows_plain_in_process_task() -> None:
    task = _tool_task()
    policy = _resolve_policy(task)

    assert validate_execution_mode(task, policy) is None
