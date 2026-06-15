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

"""Unit tests for the ``run_command`` seam inside :class:`ToolExecutor`.

The executor is the single ``run_command`` implementation: it resolves the run
into a :class:`CommandSpec` and hands it to a per-run :class:`CommandSession`,
so *where* the command runs is decided entirely by the injected backend. These
tests exercise the spec assembly, the result mapping, and the session lifecycle
with a fake backend, plus one end-to-end run against the real local backend.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.biz.task_runtime.artifact_store import FileArtifactStore
from app.biz.task_runtime.executors.tool_executor import ToolExecutor
from app.biz.task_runtime.executors.command_backend import (
    CommandResult,
    CommandSpec,
    LocalBackend,
)
from app.biz.task_runtime.models import (
    ErrorClass,
    FencingToken,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)
from app.biz.task_runtime.workspace import reset_workspace_layout, set_workspace_layout


class _FakeStore:
    """Minimal in-memory RunStore subset the executor touches."""

    def __init__(self) -> None:
        self.results: dict[str, TaskResult] = {}

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        return FencingToken(run_id=run_id, token=f"{worker_id}-tok", issued_at=0)

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        self.results[run_id] = result


class _FakeSession:
    """Records the spec it ran and whether it was closed."""

    def __init__(self, backend: "_FakeBackend") -> None:
        self._backend = backend

    async def run(self, spec: CommandSpec) -> CommandResult:
        self._backend.ran_specs.append(spec)
        return self._backend.result

    async def aclose(self) -> None:
        self._backend.close_calls += 1


class _FakeBackend:
    """Captures ``open_session`` args and the spec(s) executed."""

    def __init__(self, result: CommandResult) -> None:
        self.result = result
        self.ran_specs: list[CommandSpec] = []
        self.open_calls: list[dict[str, str]] = []
        self.close_calls = 0

    def open_session(self, *, pod_name: str = "", image: str = "") -> _FakeSession:
        self.open_calls.append({"pod_name": pod_name, "image": image})
        return _FakeSession(self)


class _FakeWorkspaceLayout:
    def __init__(self, workspace_root: Path) -> None:
        self._workspace_root = workspace_root

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int) -> Path:
        return self._workspace_root.parent / "turn" / str(turn_id)

    def workspace_path(self, agent_instance_id: int, username: str) -> Path:
        return self._workspace_root

    @property
    def chat_root(self) -> Path:
        return self._workspace_root.parent

    @property
    def skill_root(self) -> Path:
        return self._workspace_root.parent / "skills"

    def skill_roots(
        self,
        *,
        project_id: int = 0,
        agent_id: str = "",
        agent_instance_id: int = 0,
    ) -> list[tuple[str, int | str, Path]]:
        return []

    def plan_exists(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int) -> bool:
        return False


@pytest.fixture(autouse=True)
def _workspace_layout(tmp_path, request) -> None:
    token = set_workspace_layout(_FakeWorkspaceLayout(tmp_path / "workspace"))
    request.addfinalizer(lambda: reset_workspace_layout(token))


def _run(spec: TaskSpec, *, timeout_seconds: int = 600) -> TaskRun:
    return TaskRun(
        run_id="run-cmd",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=7,
        project_id=11,
        spec=spec,
        execution_policy=TaskExecutionPolicy(timeout_seconds=timeout_seconds),
        idempotency_key=spec.task_id,
        executor="local_subprocess",
        queued_at=int(time.time() * 1000),
    )


def _command_run(command, *, timeout_seconds: int = 600, **args) -> TaskRun:
    payload: dict = {} if command is None else {"command": command}
    payload.update(args)
    spec = TaskSpec(
        task_id="t-cmd",
        title="Run a command",
        dispatch=ToolDispatch(tool_name="run_command"),
        args=payload,
    )
    return _run(spec, timeout_seconds=timeout_seconds)


def _file_convert_run(**args) -> TaskRun:
    spec = TaskSpec(
        task_id="t-convert",
        title="Convert workbook",
        dispatch=ToolDispatch(tool_name="file_convert"),
        args=args,
    )
    return _run(spec)


def _tool_executor(tmp_path: Path, backend: _FakeBackend | LocalBackend) -> ToolExecutor:
    return ToolExecutor(
        artifact_store=FileArtifactStore(tmp_path / "artifacts"),
        sandbox_backend=backend,
    )


def test_tool_executor_requires_dependencies(tmp_path: Path) -> None:
    artifact_store = FileArtifactStore(tmp_path / "artifacts")
    backend = _FakeBackend(CommandResult(return_code=0))
    with pytest.raises(ValueError, match="artifact_store is required"):
        ToolExecutor(artifact_store=None, sandbox_backend=backend)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="sandbox_backend is required"):
        ToolExecutor(artifact_store=artifact_store, sandbox_backend=None)  # type: ignore[arg-type]


def test_file_convert_converts_xlsx_to_csv(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    attachments = workspace / "attachments"
    attachments.mkdir(parents=True)
    workbook_path = attachments / "cases.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Cases"
    sheet.append(["ID", "Title"])
    sheet.append(["TC-1", "Open settings"])
    workbook.save(workbook_path)

    executor = _tool_executor(tmp_path, _FakeBackend(CommandResult(return_code=0)))
    result = executor._run_file_convert_tool(_file_convert_run(input_paths=["attachments/cases.xlsx"], sheet="Cases"))

    assert result.status == TaskStatus.COMPLETED
    assert "Converted 1 Excel file" in result.summary
    assert result.primary_artifact is not None
    assert result.primary_artifact.filepath.endswith("output/csv/cases.csv")
    csv_path = workspace / "results" / "batch-1" / "run-cmd" / "result" / "output" / "csv" / "cases.csv"
    assert csv_path.read_text(encoding="utf-8").splitlines() == ["ID,Title", "TC-1,Open settings"]


@pytest.mark.asyncio
async def test_run_command_builds_command_spec_and_opens_session(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    backend = _FakeBackend(CommandResult(return_code=0, stdout="hi\n"))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("echo hi", timeout_seconds=42)

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert result.output == "hi\n"
    assert backend.close_calls == 1
    assert backend.open_calls == [{"pod_name": "task-run-cmd", "image": ""}]

    result_dir = workspace / "results" / "batch-1" / "run-cmd" / "result"
    (spec,) = backend.ran_specs
    assert spec.argv == ["sh", "-lc", "echo hi"]
    assert spec.cwd == str(workspace)
    assert spec.timeout_seconds == 42
    assert spec.env == {
        "SICO_TASK_RUN_ID": "run-cmd",
        "SICO_AGENT_INSTANCE_ID": "7",
        "SICO_PROJECT_ID": "11",
        "SICO_APP_NAME": "sico",
        "SICO_WORKSPACE_DIR": str(workspace),
        "SICO_RESULT_DIR": str(result_dir),
    }
    result_mount, workspace_mount = spec.mounts
    assert result_mount.mount_path == str(result_dir)
    assert result_mount.host_path == str(result_dir)
    assert result_mount.read_only is False
    assert workspace_mount.mount_path == str(workspace)
    assert workspace_mount.host_path == str(workspace)
    assert workspace_mount.read_only is True
    assert spec.metadata["agent_instance_id"] == "7"
    # The per-run result directory is created lazily before the command runs.
    assert result_dir.is_dir()


@pytest.mark.asyncio
async def test_run_command_mounts_shared_workspace_read_only(tmp_path) -> None:
    shared = tmp_path / "workspace"
    backend = _FakeBackend(CommandResult(return_code=0))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("ls")

    await executor.run(run, _FakeStore())

    result_dir = shared / "results" / "batch-1" / "run-cmd" / "result"
    (spec,) = backend.ran_specs
    assert spec.cwd == str(shared)
    assert spec.env["SICO_WORKSPACE_DIR"] == str(shared)
    assert spec.env["SICO_RESULT_DIR"] == str(result_dir)
    result_mount, workspace_mount = spec.mounts
    assert result_mount.host_path == str(result_dir)
    assert result_mount.read_only is False
    assert workspace_mount.host_path == str(shared)
    assert workspace_mount.read_only is True


@pytest.mark.asyncio
async def test_run_command_args_timeout_overrides_policy(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=0))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("ls", timeout_seconds=600, timeout=5)

    await executor.run(run, _FakeStore())

    (spec,) = backend.ran_specs
    assert spec.timeout_seconds == 5


@pytest.mark.asyncio
async def test_run_command_missing_command_is_user_input_failure(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=0))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run(None)

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT
    assert backend.ran_specs == []
    assert backend.open_calls == []


@pytest.mark.asyncio
async def test_run_command_nonzero_exit_is_skill_runtime_failure(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=2, stderr="boom"))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("false")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.SKILL_RUNTIME
    assert result.error_message == "boom"


@pytest.mark.asyncio
async def test_run_command_summary_includes_stdout(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=0, stdout="hello world\n"))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("echo hello world")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert "finished with exit code 0" in result.summary
    assert "stdout:\nhello world" in result.summary


@pytest.mark.asyncio
async def test_run_command_summary_includes_stderr_on_failure(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=2, stdout="partial\n", stderr="boom\n"))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("false")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert "failed with exit code 2" in result.summary
    assert "stdout:\npartial" in result.summary
    assert "stderr:\nboom" in result.summary


@pytest.mark.asyncio
async def test_run_command_system_error_is_transient_failure(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=-1, system_error="backend unavailable"))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("anything")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.TRANSIENT
    assert "backend unavailable" in result.error_message


@pytest.mark.asyncio
async def test_run_command_timeout_maps_to_timed_out(tmp_path) -> None:
    backend = _FakeBackend(CommandResult(return_code=-1, system_error="command timed out after 5s"))
    executor = _tool_executor(tmp_path, backend)
    run = _command_run("sleep 99")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.TIMED_OUT
    assert result.error_class == ErrorClass.TIMEOUT


@pytest.mark.asyncio
async def test_run_command_closes_session_even_when_run_raises(tmp_path) -> None:
    async def _boom(_spec: CommandSpec) -> CommandResult:
        raise RuntimeError("exec exploded")

    class _RaisingBackend(_FakeBackend):
        def open_session(self, *, pod_name: str = "", image: str = ""):
            session = _FakeSession(self)
            session.run = _boom  # type: ignore[method-assign]
            return session

    raising = _RaisingBackend(CommandResult(return_code=0))
    executor = _tool_executor(tmp_path, raising)
    run = _command_run("boom")

    with pytest.raises(RuntimeError, match="exec exploded"):
        await executor.run(run, _FakeStore())
    assert raising.close_calls == 1


@pytest.mark.skipif(sys.platform == "win32", reason="requires POSIX shell (sh)")
@pytest.mark.asyncio
async def test_run_command_runs_for_real_via_local_backend(tmp_path) -> None:
    executor = _tool_executor(tmp_path, LocalBackend())
    run = _command_run("echo sico-rocks")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert "sico-rocks" in result.output
