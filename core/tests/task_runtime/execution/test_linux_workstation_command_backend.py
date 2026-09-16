from __future__ import annotations

import asyncio
import base64
import json
from contextlib import suppress
from dataclasses import replace
from pathlib import Path

import pytest

from app.biz.reverse_grpc.sandbox import LinuxWorkstationSandboxHttpResult
from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    SandboxLeaseRef,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
)
from app.biz.task_runtime.execution.command.linux_workstation import (
    LinuxWorkstationCommandBackend,
    LinuxWorkstationCommandError,
)
from app.biz.task_runtime.execution.command.contracts import CommandMount, CommandSpec


def _response(data: dict | None = None, *, status_code: int = 200, body: bytes = b"") -> LinuxWorkstationSandboxHttpResult:
    body_text = json.dumps({"success": True, "data": data}) if data is not None else ""
    return LinuxWorkstationSandboxHttpResult(
        status_code=status_code,
        content_type="application/json",
        body_text=body_text,
        body_bytes=body or body_text.encode(),
    )


class _Service:
    def __init__(
        self,
        *,
        block_action: bool = False,
        symlink_result: bool = False,
        stderr_only: bool = False,
    ) -> None:
        self.calls: list[dict] = []
        self.view_count = 0
        self.action_running = asyncio.Event()
        self.block_action = block_action
        self.symlink_result = symlink_result
        self.stderr_only = stderr_only

    def proxy_linux_workstation_http(self, **kwargs) -> LinuxWorkstationSandboxHttpResult:
        self.calls.append(kwargs)
        path = kwargs["path"]
        if path == "/v1/shell/view":
            self.view_count += 1
            if self.view_count == 1:
                response = _response({"status": "completed", "exit_code": 0, "stdout": "", "stderr": ""})
            elif self.block_action:
                self.action_running.set()
                response = _response({"status": "running", "exit_code": None, "stdout": "", "stderr": ""})
            elif self.stderr_only:
                response = _response(
                    {"status": "completed", "exit_code": 3, "output": "only-error", "stdout": "", "stderr": "only-error"}
                )
            else:
                response = _response(
                    {
                        "status": "completed",
                        "exit_code": 0,
                        "output": "done\nwarning\n",
                        "stdout": "done\n",
                        "stderr": "warning\n",
                    }
                )
        elif path == "/v1/file/list":
            remote_root = kwargs["json_body"]["path"]
            response = _response(
                {
                    "files": [
                        {
                            "path": f"{remote_root}/nested/artifact.bin",
                            "is_directory": False,
                            "is_symlink": self.symlink_result,
                        }
                    ]
                }
            )
        elif path == "/v1/file/download":
            response = LinuxWorkstationSandboxHttpResult(200, "application/octet-stream", "", b"artifact-bytes")
        elif path == "/v1/shell/kill":
            response = _response(status_code=404)
        else:
            response = _response({"status": "completed", "exit_code": 0})
        return response


def _lease(*, sandbox_id: str = "linux_workstation:one") -> SandboxLeaseRef:
    return SandboxLeaseRef(
        sandbox_id=sandbox_id,
        type="linux_workstation",
        os="linux",
        endpoint="/api/sico/sandbox/resources/linux_workstation/resource-1/",
        acquired_at=1,
    )


def _run(lease: SandboxLeaseRef | None = None) -> TaskRun:
    spec = TaskSpec(
        task_id="task-1",
        title="Direct Linux Workstation",
        dispatch=CapabilityDispatch(capability_id="skill:test.run"),
    )
    return TaskRun(
        run_id="run-1",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent-1",
        agent_instance_id=7,
        project_id=9,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key="task-1",
        executor="command_backend",
        queued_at=1,
        sandbox=lease or _lease(),
    )


def _spec(tmp_path: Path) -> tuple[CommandSpec, Path, Path, Path]:
    workspace = tmp_path / "workspace"
    result = workspace / "results" / "run-1"
    runtime = result / "runtime"
    workspace.mkdir()
    runtime.mkdir(parents=True)
    (workspace / "input.txt").write_bytes(b"workspace-input")
    (runtime / "runner.py").write_bytes(b"runtime-input")
    spec = CommandSpec(
        argv=["python", str(runtime / "runner.py"), str(workspace / "input.txt")],
        cwd=str(runtime),
        env={"SICO_WORKSPACE_DIR": str(workspace), "SICO_RESULT_DIR": str(result)},
        mounts=[
            CommandMount("workspace", str(workspace), str(workspace), read_only=True),
            CommandMount("skill-runtime", str(runtime), str(runtime), read_only=True),
            CommandMount("skill-result", str(result), str(result)),
        ],
        timeout_seconds=5,
    )
    return spec, workspace, runtime, result


@pytest.mark.asyncio
async def test_linux_workstation_session_stages_maps_executes_retrieves_and_cleans(tmp_path: Path) -> None:
    service = _Service()
    spec, _, _, result_dir = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(spec)
    await session.aclose()
    await session.aclose()

    assert outcome.return_code == 0
    assert outcome.stdout == "done\n"
    assert outcome.stderr == "warning\n"
    assert (result_dir / "nested" / "artifact.bin").read_bytes() == b"artifact-bytes"

    uploads = [call["json_body"] for call in service.calls if call["path"] == "/v1/file/write"]
    assert {base64.b64decode(upload["content"]) for upload in uploads} == {b"workspace-input", b"runtime-input"}
    assert sum(base64.b64decode(upload["content"]) == b"runtime-input" for upload in uploads) == 1

    exec_calls = [call["json_body"] for call in service.calls if call["path"] == "/v1/shell/exec"]
    action = exec_calls[1]
    assert action["argv"][0] == "python"
    assert action["argv"][1].endswith("/runtime/runner.py")
    assert action["argv"][2].endswith("/workspace/input.txt")
    assert action["exec_dir"].endswith("/runtime")
    assert action["env"]["SICO_WORKSPACE_DIR"].endswith("/workspace")
    assert action["env"]["SICO_RESULT_DIR"].endswith("/results")
    assert exec_calls[-1]["argv"][:2] == ["rm", "-rf"]
    download = next(call for call in service.calls if call["path"] == "/v1/file/download")
    assert download["query"]["root"].endswith("/results")
    kill_index = next(index for index, call in enumerate(service.calls) if call["path"] == "/v1/shell/kill")
    list_index = next(index for index, call in enumerate(service.calls) if call["path"] == "/v1/file/list")
    assert kill_index < list_index
    assert service.calls[-1]["method"] == "DELETE"
    assert service.calls[-1]["path"].startswith("/v1/shell/sessions/")


@pytest.mark.asyncio
async def test_linux_workstation_session_revalidates_lease_before_transport(tmp_path: Path) -> None:
    service = _Service()
    run = _run()
    session = LinuxWorkstationCommandBackend(run, service=service).open_session()
    run.sandbox = _lease(sandbox_id="linux_workstation:changed")
    spec, _, _, _ = _spec(tmp_path)

    outcome = await session.run(spec)

    assert outcome.return_code == -1
    assert "lease changed" in outcome.system_error
    assert service.calls == []


@pytest.mark.asyncio
async def test_linux_workstation_session_maps_an_exact_file_mount_to_the_uploaded_file(tmp_path: Path) -> None:
    service = _Service()
    source = tmp_path / "source.bin"
    source.write_bytes(b"source-bytes")
    spec = CommandSpec(
        argv=["cat", str(source)],
        cwd="/home/gem",
        mounts=[CommandMount("source-file", str(source), str(source), read_only=True)],
        timeout_seconds=5,
    )
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(spec)
    await session.aclose()

    assert outcome.return_code == 0
    exec_calls = [call["json_body"] for call in service.calls if call["path"] == "/v1/shell/exec"]
    assert exec_calls[1]["argv"][1].endswith("/inputs/source-file/source.bin")


def test_linux_workstation_session_path_mapping_requires_a_boundary_and_rejects_traversal() -> None:
    session = LinuxWorkstationCommandBackend(_run(), service=_Service()).open_session()
    session._mount_paths = {"/local/workspace": "/home/gem/.sico/runs/one/workspace"}

    assert session._map_value("/local/workspaceable") == "/local/workspaceable"
    assert session._map_value("/local/workspace/file.txt").endswith("/workspace/file.txt")
    with pytest.raises(LinuxWorkstationCommandError, match="traversal"):
        session._map_value("/local/workspace/../../outside")


@pytest.mark.asyncio
async def test_linux_workstation_session_does_not_stage_workspace_when_access_is_none(tmp_path: Path) -> None:
    service = _Service()
    spec, _, _, _ = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(replace(spec, metadata={"workspace_access": "none"}))
    await session.aclose()

    assert outcome.return_code == 0
    uploads = [call["json_body"] for call in service.calls if call["path"] == "/v1/file/write"]
    assert [base64.b64decode(upload["content"]) for upload in uploads] == [b"runtime-input"]


@pytest.mark.asyncio
async def test_linux_workstation_session_synchronizes_read_write_workspace_back_to_core(tmp_path: Path) -> None:
    service = _Service()
    spec, workspace, _, result_dir = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(replace(spec, metadata={"workspace_access": "read_write"}))
    await session.aclose()

    assert outcome.return_code == 0
    assert not (workspace / "input.txt").exists()
    assert (workspace / "nested" / "artifact.bin").read_bytes() == b"artifact-bytes"
    assert (result_dir / "nested" / "artifact.bin").read_bytes() == b"artifact-bytes"
    listed_roots = [call["json_body"]["path"] for call in service.calls if call["path"] == "/v1/file/list"]
    assert listed_roots[0].endswith("/results")
    assert listed_roots[1].endswith("/workspace")
    download_roots = [call["query"]["root"] for call in service.calls if call["path"] == "/v1/file/download"]
    assert any(root.endswith("/results") for root in download_roots)
    assert any(root.endswith("/workspace") for root in download_roots)


@pytest.mark.asyncio
async def test_linux_workstation_session_rejects_symlinked_result_files(tmp_path: Path) -> None:
    service = _Service(symlink_result=True)
    spec, _, _, _ = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(spec)

    assert outcome.return_code == 0
    with pytest.raises(LinuxWorkstationCommandError, match="must not be symlinks"):
        await session.aclose()
    assert not any(call["path"] == "/v1/file/download" for call in service.calls)


@pytest.mark.asyncio
async def test_linux_workstation_session_preserves_empty_stdout_separately_from_stderr(tmp_path: Path) -> None:
    service = _Service(stderr_only=True)
    spec, _, _, _ = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(spec)
    await session.aclose()

    assert outcome.return_code == 3
    assert outcome.stdout == ""
    assert outcome.stderr == "only-error"


@pytest.mark.asyncio
async def test_linux_workstation_session_rejects_a_symlinked_local_result_root(tmp_path: Path, monkeypatch) -> None:
    service = _Service()
    spec, _, _, result_dir = _spec(tmp_path)
    original_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda path: path == result_dir or original_is_symlink(path))
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(spec)

    assert outcome.return_code == 0
    with pytest.raises(LinuxWorkstationCommandError, match="result directory must not be a symlink"):
        await session.aclose()


@pytest.mark.asyncio
async def test_linux_workstation_session_kills_and_cleans_after_cancellation(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.biz.task_runtime.execution.command.linux_workstation._POLL_SECONDS", 0)
    service = _Service(block_action=True)
    spec, _, _, _ = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()
    execution = asyncio.create_task(session.run(spec))
    await service.action_running.wait()

    execution.cancel()
    with suppress(asyncio.CancelledError):
        await execution
    await session.aclose()

    assert any(call["path"] == "/v1/shell/kill" for call in service.calls)
    assert any(call["method"] == "DELETE" and "/v1/shell/sessions/" in call["path"] for call in service.calls)
    assert any(
        call["path"] == "/v1/shell/exec" and call["json_body"].get("argv", [])[:2] == ["rm", "-rf"] for call in service.calls
    )


@pytest.mark.asyncio
async def test_linux_workstation_session_kills_and_reports_timeout(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr("app.biz.task_runtime.execution.command.linux_workstation._POLL_SECONDS", 0)
    service = _Service(block_action=True)
    spec, _, _, _ = _spec(tmp_path)
    session = LinuxWorkstationCommandBackend(_run(), service=service).open_session()

    outcome = await session.run(replace(spec, timeout_seconds=0.001))
    await session.aclose()

    assert outcome.return_code == -1
    assert "timed out" in outcome.system_error
    assert any(call["path"] == "/v1/shell/kill" for call in service.calls)
