from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.biz.reverse_grpc.sandbox import LinuxWorkstationSandboxHttpResult
from app.biz.task_runtime.capabilities.linux_workstation import LinuxWorkstationCapabilityProvider
from app.biz.task_runtime.capabilities.sandbox import render_sandbox_delegation_section
from app.biz.task_runtime.capabilities.descriptors import CapabilityContext, CatalogueQuery, ResolveContext
from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    ErrorClass,
    SandboxLeaseRef,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
    TaskStatus,
)


class _Service:
    def __init__(
        self,
        response: LinuxWorkstationSandboxHttpResult | None = None,
        *,
        result_files: dict[str, bytes] | None = None,
        absolute_files: dict[str, bytes] | None = None,
    ) -> None:
        self.response = response or LinuxWorkstationSandboxHttpResult(
            status_code=200,
            content_type="application/json",
            body_text='{"success":true,"data":{"output":"hello\\n","status":"completed","exit_code":0}}',
            body_bytes=b'{"success":true}',
        )
        self.result_files = result_files or {}
        self.absolute_files = absolute_files or {}
        self.listed_root = ""
        self.calls: list[dict] = []

    def proxy_linux_workstation_http(self, **kwargs) -> LinuxWorkstationSandboxHttpResult:
        self.calls.append(kwargs)
        if kwargs["path"] == "/v1/file/list":
            self.listed_root = kwargs["json_body"]["path"]
            files = [
                {"path": f"{self.listed_root}/{path}", "is_directory": False, "is_symlink": False} for path in self.result_files
            ]
            body_text = json.dumps({"success": True, "data": {"files": files}})
            return LinuxWorkstationSandboxHttpResult(200, "application/json", body_text, body_text.encode())
        if kwargs["path"] == "/v1/file/download":
            path = kwargs["query"]["path"]
            relative = path.removeprefix(self.listed_root).lstrip("/") if self.listed_root else ""
            content = self.result_files.get(relative, self.absolute_files.get(path, b""))
            offset = kwargs["query"]["offset"]
            limit = kwargs["query"]["limit"]
            return LinuxWorkstationSandboxHttpResult(200, "application/octet-stream", "", content[offset : offset + limit])
        return self.response


class _ArtifactStore:
    def __init__(self) -> None:
        self.puts: list[tuple[str, str, bytes]] = []

    def put(self, run_id: str, name: str, src_path: Path, *, artifact_type: str = "file", role: str = "raw"):
        from app.biz.task_runtime.domain.models import ArtifactRef

        self.puts.append((run_id, name, src_path.read_bytes()))
        return ArtifactRef(name=name, type=artifact_type, role=role, uri=f"memory://{run_id}/{name}")


def _lease(*, sandbox_id: str = "linux_workstation:one") -> SandboxLeaseRef:
    return SandboxLeaseRef(
        sandbox_id=sandbox_id,
        type="linux_workstation",
        os="linux",
        endpoint="/api/sico/sandbox/resources/linux_workstation/resource-1/",
        acquired_at=1,
    )


def _run(lease: SandboxLeaseRef | None, *, released: bool = False) -> TaskRun:
    return TaskRun.model_construct(
        run_id="run-1",
        batch_id="batch-1",
        username="alice@example.com",
        agent_instance_id=7,
        project_id=9,
        spec=TaskSpec(
            task_id="task-1",
            title="Use Linux Workstation",
            dispatch=CapabilityDispatch(capability_id="linux_workstation:shell:exec"),
            args={},
        ),
        execution_policy=TaskExecutionPolicy(),
        sandbox=lease,
        sandbox_released=released,
        queued_at=1,
        started_at=2,
    )


def _context(run: TaskRun, descriptor, tmp_path: Path, arguments: dict) -> CapabilityContext:
    result_dir = tmp_path / "result"
    result_dir.mkdir()
    return CapabilityContext(
        run=run,
        descriptor=descriptor,
        arguments=arguments,
        workspace=tmp_path,
        run_dir=tmp_path,
        result_dir=result_dir,
        started_at=2,
    )


@pytest.mark.asyncio
async def test_catalogue_exposes_all_operations_only_for_a_linux_workstation_lease() -> None:
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=_Service())

    assert await provider.list_descriptors(CatalogueQuery()) == ()

    descriptors = await provider.list_descriptors(CatalogueQuery(caller=ResolveContext(sandbox=_lease())))

    assert {descriptor.capability_id for descriptor in descriptors} == {
        "linux_workstation:shell:exec",
        "linux_workstation:mouse:click",
        "linux_workstation:mouse:move",
        "linux_workstation:mouse:scroll",
        "linux_workstation:keyboard:type",
        "linux_workstation:keyboard:press",
        "linux_workstation:browser:open_url",
        "linux_workstation:browser:screenshot",
        "linux_workstation:file:export",
        "linux_workstation:file:read",
        "linux_workstation:file:write",
        "linux_workstation:file:list",
    }
    assert all(descriptor.required_sandbox == ("linux_workstation",) for descriptor in descriptors)
    shell = next(descriptor for descriptor in descriptors if descriptor.capability_id == "linux_workstation:shell:exec")
    assert "writable" in shell.description
    assert "builtin:run_command" in shell.when_to_use


def test_delegation_section_uses_runtime_operation_ids() -> None:
    section = render_sandbox_delegation_section({"linux_workstation"})

    assert "Delegate ordinary execution goals without selecting a namespace" in section
    assert "human-defined profile" in section
    assert "not direct chat tools" in section
    for selector in (
        "linux_workstation:shell:**",
        "linux_workstation:browser:**",
        "linux_workstation:mouse:**",
        "linux_workstation:keyboard:**",
        "linux_workstation:file:**",
    ):
        assert f"namespace: {selector}" in section


def test_delegation_section_omits_unassigned_sandbox_capabilities() -> None:
    assert render_sandbox_delegation_section(set()) == ""
    assert render_sandbox_delegation_section({"emulator"}) == ""


@pytest.mark.asyncio
async def test_shell_exec_revalidates_and_dispatches_to_the_leased_proxy(tmp_path: Path) -> None:
    service = _Service()
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=service)
    binding = await provider.resolve("linux_workstation:shell:exec", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(lease), binding.descriptor, tmp_path, {"command": "printf hello"}))

    assert result.status == TaskStatus.COMPLETED
    assert json.loads(result.output) == {
        "command": "printf hello",
        "status": "completed",
        "exit_code": 0,
        "stdout": "hello\n",
        "stderr": "",
    }
    shell_calls = [call for call in service.calls if call["path"] == "/v1/shell/exec"]
    assert shell_calls[0]["json_body"]["argv"][:2] == ["mkdir", "-p"]
    remote_result_dir = shell_calls[0]["json_body"]["argv"][2]
    assert shell_calls[1]["json_body"] == {
        "command": "printf hello",
        "exec_dir": "/home/gem",
        "timeout": 25,
        "env": {"SICO_RESULT_DIR": remote_result_dir},
    }
    assert service.calls[-1]["path"] == "/v1/file/list"


@pytest.mark.asyncio
async def test_shell_exec_unwraps_proxy_envelopes_and_preserves_streams(tmp_path: Path) -> None:
    body = json.dumps(
        {
            "code": 0,
            "msg": "success",
            "data": {
                "success": True,
                "data": {
                    "command": "cat missing.txt",
                    "status": "completed",
                    "exit_code": 0,
                    "stdout": "hello\n",
                    "stderr": "warning\n",
                },
            },
        }
    )
    service = _Service(LinuxWorkstationSandboxHttpResult(200, "application/json", body, body.encode()))
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=service)
    binding = await provider.resolve("linux_workstation:shell:exec", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(lease), binding.descriptor, tmp_path, {"command": "cat missing.txt"}))

    assert result.status == TaskStatus.COMPLETED
    assert json.loads(result.output) == {
        "command": "cat missing.txt",
        "status": "completed",
        "exit_code": 0,
        "stdout": "hello\n",
        "stderr": "warning\n",
    }


@pytest.mark.asyncio
async def test_shell_exec_publishes_files_written_to_result_dir(tmp_path: Path) -> None:
    service = _Service(result_files={"report/out.txt": b"artifact-output"})
    store = _ArtifactStore()
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=store, service=service)
    binding = await provider.resolve("linux_workstation:shell:exec", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(lease), binding.descriptor, tmp_path, {"command": "make"}))

    assert result.status == TaskStatus.COMPLETED
    assert result.primary_artifact is not None
    assert result.primary_artifact.filepath == "result/report/out.txt"
    assert store.puts == [("run-1", "out.txt", b"artifact-output")]
    download = next(call for call in service.calls if call["path"] == "/v1/file/download")
    assert download["query"]["root"].endswith("/results")


@pytest.mark.asyncio
async def test_file_export_downloads_and_publishes_an_existing_linux_workstation_file(tmp_path: Path) -> None:
    service = _Service(absolute_files={"/home/gem/result/deck.pptx": b"pptx-bytes"})
    store = _ArtifactStore()
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=store, service=service)
    binding = await provider.resolve("linux_workstation:file:export", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(
        _context(_run(lease), binding.descriptor, tmp_path, {"path": "/home/gem/result/deck.pptx"})
    )

    assert result.status == TaskStatus.COMPLETED
    assert result.primary_artifact is not None
    assert result.primary_artifact.filepath == "result/deck.pptx"
    assert store.puts == [("run-1", "deck.pptx", b"pptx-bytes")]
    download = next(call for call in service.calls if call["path"] == "/v1/file/download")
    assert download["query"]["root"] == "/home/gem"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keys", "expected"),
    [
        (["ENTER"], {"action_type": "PRESS", "key": "enter"}),
        (["Return"], {"action_type": "PRESS", "key": "return"}),
        (["Tab"], {"action_type": "PRESS", "key": "tab"}),
        (["Ctrl", "L"], {"action_type": "HOTKEY", "keys": ["ctrl", "l"]}),
        (["Control", "Page Down"], {"action_type": "HOTKEY", "keys": ["ctrl", "pagedown"]}),
    ],
)
async def test_keyboard_press_canonicalizes_model_key_names(
    tmp_path: Path,
    keys: list[str],
    expected: dict,
) -> None:
    service = _Service()
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=service)
    binding = await provider.resolve("linux_workstation:keyboard:press", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(lease), binding.descriptor, tmp_path, {"keys": keys}))

    assert result.status == TaskStatus.COMPLETED
    assert service.calls[0]["json_body"] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("released", [False, True])
async def test_invocation_rejects_changed_or_released_lease(tmp_path: Path, released: bool) -> None:
    service = _Service()
    original = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=service)
    binding = await provider.resolve("linux_workstation:shell:exec", ResolveContext(sandbox=original))
    assert binding is not None
    current = original if released else _lease(sandbox_id="linux_workstation:two")

    result = await binding.handler.execute(
        _context(_run(current, released=released), binding.descriptor, tmp_path, {"command": "true"})
    )

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.POLICY_DENY
    assert service.calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "current",
    [
        SandboxLeaseRef(
            sandbox_id="linux_workstation:one",
            type="physical",
            os="linux",
            endpoint="http://physical",
            acquired_at=1,
        ),
        SandboxLeaseRef(
            sandbox_id="linux_workstation:one",
            type="linux_workstation",
            os="linux",
            endpoint="http://linux-workstation",
            acquired_at=1,
            expires_at=1,
        ),
    ],
)
async def test_invocation_rejects_wrong_type_or_expired_lease(tmp_path: Path, current: SandboxLeaseRef) -> None:
    service = _Service()
    original = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=service)
    binding = await provider.resolve("linux_workstation:shell:exec", ResolveContext(sandbox=original))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(current), binding.descriptor, tmp_path, {"command": "true"}))

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.POLICY_DENY
    assert service.calls == []


@pytest.mark.asyncio
async def test_file_operations_are_bounded_to_linux_workstation_home(tmp_path: Path) -> None:
    service = _Service()
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=_ArtifactStore(), service=service)
    binding = await provider.resolve("linux_workstation:file:read", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(lease), binding.descriptor, tmp_path, {"path": "/etc/passwd"}))

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT
    assert service.calls == []


@pytest.mark.asyncio
async def test_screenshot_is_stored_as_a_primary_artifact(tmp_path: Path) -> None:
    service = _Service(
        LinuxWorkstationSandboxHttpResult(
            status_code=200,
            content_type="image/png",
            body_text="",
            body_bytes=b"png-bytes",
        )
    )
    store = _ArtifactStore()
    lease = _lease()
    provider = LinuxWorkstationCapabilityProvider(artifact_store=store, service=service)
    binding = await provider.resolve("linux_workstation:browser:screenshot", ResolveContext(sandbox=lease))
    assert binding is not None

    result = await binding.handler.execute(_context(_run(lease), binding.descriptor, tmp_path, {}))

    assert result.status == TaskStatus.COMPLETED
    assert result.primary_artifact is not None
    assert result.primary_artifact.type == "screenshot"
    assert result.primary_artifact.filepath == "result/linux-workstation-screenshot.png"
    assert store.puts == [("run-1", "linux-workstation-screenshot.png", b"png-bytes")]
