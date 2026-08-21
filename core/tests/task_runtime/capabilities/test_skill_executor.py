"""Unit tests for the skill capability provider.

The provider lowers a resolved action's pre-generated argv steps into
:class:`CommandSpec` objects and runs them, in order, inside *one* per-run
:class:`CommandSession`, so *where* a skill runs (local/docker/k8s) is decided
entirely by the injected backend. These tests cover spec assembly + placeholder
substitution + session lifecycle with a fake backend, one end-to-end run against
the real local backend, and the parameter-projection helpers.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

from app.biz.task_runtime.capabilities.resolver import CapabilityResolver
from app.biz.task_runtime.capabilities.skill import (
    SkillCapabilityProvider,
    _normalize_invocation_parameters,
    _prepare_parameters,
    _sandbox_values_from_lease,
)
from app.biz.task_runtime.capabilities.executor import CapabilityExecutor
from app.biz.task_runtime.execution.command.contracts import CommandResult, CommandSpec
from app.biz.task_runtime.execution.command.local import LocalBackend
from app.biz.task_runtime.storage.artifact_store import FileArtifactStore
from app.biz.task_runtime.domain.models import (
    CapabilityDispatch,
    ErrorClass,
    FencingToken,
    SandboxLeaseRef,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.capabilities.loader import SkillLoader
from app.biz.skill.resolver import ResolvedAction, ResolvedActionParameter, ResolvedActionStep
from app.biz.task_runtime.workspace.layout import reset_workspace_layout, set_workspace_layout
from app.biz.source import WorkspaceSourceService
from app.biz.source.persistence.repository import WorkspaceSourceRepository


class _FakeStore:
    """Minimal in-memory RunStore subset the executor touches."""

    def __init__(self) -> None:
        self.results: dict[str, TaskResult] = {}

    async def claim_run(self, run_id: str, worker_id: str) -> FencingToken:
        return FencingToken(run_id=run_id, token=f"{worker_id}-tok", issued_at=0)

    async def write_result(self, run_id: str, result: TaskResult, token: FencingToken) -> None:
        self.results[run_id] = result


class _FakeSession:
    """Records every spec it ran and whether it was closed."""

    def __init__(self, backend: "_FakeBackend") -> None:
        self._backend = backend
        self._step = 0

    async def run(self, spec: CommandSpec) -> CommandResult:
        for mount in spec.mounts:
            if mount.name == "skill-runtime" and (Path(mount.host_path) / "runtime.txt").exists():
                self._backend.runtime_file_seen = True
        self._backend.ran_specs.append(spec)
        result = self._backend.results[min(self._step, len(self._backend.results) - 1)]
        self._step += 1
        return result

    async def aclose(self) -> None:
        self._backend.close_calls += 1


class _FakeBackend:
    """Captures ``open_session`` args and the spec(s) executed."""

    def __init__(self, *results: CommandResult) -> None:
        self.results = list(results) or [CommandResult(return_code=0)]
        self.ran_specs: list[CommandSpec] = []
        self.open_calls: list[dict[str, str]] = []
        self.close_calls = 0
        self.runtime_file_seen = False

    def open_session(self, *, pod_name: str = "", image: str = "") -> _FakeSession:
        self.open_calls.append({"pod_name": pod_name, "image": image})
        return _FakeSession(self)


class _FakeWorkspaceLayout:
    def __init__(self, workspace_root: Path) -> None:
        self._workspace_root = workspace_root

    def turn_path(self, agent_instance_id: int, username: str, turn_id: int, *, conversation_id: int = 0) -> Path:
        return self._workspace_root.parent / "turn" / str(turn_id)

    def workspace_path(self, agent_instance_id: int, username: str, *, conversation_id: int = 0) -> Path:
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


def _write_skill(workspace: Path, *, skill_id: int = 100, name: str, steps: list[dict]) -> None:
    """Stage a resolved skill so ``SkillLoader(workspace).load_action`` finds it."""
    staged_root = workspace.parent / "skills" / str(skill_id)
    (staged_root / "runtime").mkdir(parents=True, exist_ok=True)
    (staged_root / "runtime" / "runtime.txt").write_text("runtime source", encoding="utf-8")
    (staged_root / "resolved").mkdir(parents=True, exist_ok=True)
    (staged_root / "resolved" / "actions.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "actions": [
                    {
                        "name": "run",
                        "description": "Run a test.",
                        "parameters": [{"name": "greeting", "description": "Greeting text."}],
                        "steps": steps,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    skills_dir = workspace / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)
    (skills_dir / "index.json").write_text(
        json.dumps([{"id": skill_id, "name": name, "description": "Test skill."}]),
        encoding="utf-8",
    )


def _skill_run(*, args: dict | None = None, timeout_seconds: int = 600) -> TaskRun:
    spec = TaskSpec(
        task_id="t-skill",
        title="Run a skill",
        dispatch=CapabilityDispatch(capability_id="skill:android-test.run"),
        args={"greeting": "hello", **(args or {})},
    )
    return TaskRun(
        run_id="run-skill",
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


def _artifact_store(tmp_path: Path) -> FileArtifactStore:
    return FileArtifactStore(tmp_path / "artifacts")


def _skill_executor(workspace: Path, tmp_path: Path, backend) -> CapabilityExecutor:
    provider = SkillCapabilityProvider(
        SkillLoader(workspace),
        artifact_store=_artifact_store(tmp_path),
        command_backend=backend,
    )
    return CapabilityExecutor(CapabilityResolver((provider,)))


@pytest.mark.asyncio
async def test_skill_builds_specs_and_reuses_one_session(tmp_path, monkeypatch) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(
        workspace,
        name="android-test",
        steps=[{"argv": ["echo", "{greeting}"]}, {"argv": ["echo", "{workspace_dir}"]}],
    )
    backend = _FakeBackend(CommandResult(return_code=0, stdout="hi\n"))
    executor = _skill_executor(workspace, tmp_path, backend)
    run = _skill_run(timeout_seconds=42)
    monkeypatch.setenv("SICO_ENDPOINT", "http://sico-backend.sico.svc.cluster.local:8080")

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    # One session opened for the whole run, reused across both steps, closed once.
    assert backend.open_calls == [{"pod_name": "skill-run-skill", "image": ""}]
    assert backend.close_calls == 1
    assert len(backend.ran_specs) == 2

    first, second = backend.ran_specs
    assert first.argv == ["echo", "hello"]
    assert second.argv == ["echo", str(workspace)]
    assert first.timeout_seconds == 42
    assert first.env["SICO_WORKSPACE_DIR"] == str(workspace)
    assert first.env["SICO_AGENT_INSTANCE_ID"] == "7"
    assert first.env["SICO_APP_NAME"] == "sico"
    assert first.env["SICO_ENDPOINT"] == "http://sico-backend.sico.svc.cluster.local:8080"
    assert "SICO_RESULT_DIR" in first.env
    mount_names = {mount.name for mount in first.mounts}
    assert mount_names == {"workspace", "skill-runtime", "skill-result"}
    run_runtime = workspace / "results" / "batch-1" / "run-skill" / "runtime"
    runtime_mount = next(mount for mount in first.mounts if mount.name == "skill-runtime")
    assert first.cwd == str(run_runtime)
    assert runtime_mount.host_path == str(run_runtime)
    assert runtime_mount.mount_path == str(run_runtime)
    assert backend.runtime_file_seen is True
    assert not run_runtime.exists()


@pytest.mark.asyncio
async def test_skill_optional_argv_appended_only_when_param_present(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(
        workspace,
        name="android-test",
        steps=[{"argv": ["echo", "{greeting}"], "optional_argv": [["--lang", "{locale}"]]}],
    )
    # The action must declare every parameter it references.
    actions_path = workspace.parent / "skills" / "100" / "resolved" / "actions.json"
    data = json.loads(actions_path.read_text(encoding="utf-8"))
    data["actions"][0]["parameters"].append({"name": "locale", "description": "Locale."})
    actions_path.write_text(json.dumps(data), encoding="utf-8")

    backend = _FakeBackend(CommandResult(return_code=0))
    executor = _skill_executor(workspace, tmp_path, backend)

    # Without the optional parameter, the optional group is dropped.
    await executor.run(_skill_run(), _FakeStore())
    assert backend.ran_specs[-1].argv == ["echo", "hello"]

    # With the optional parameter present, the group is appended.
    backend.ran_specs.clear()
    await executor.run(_skill_run(args={"locale": "en"}), _FakeStore())
    assert backend.ran_specs[-1].argv == ["echo", "hello", "--lang", "en"]


@pytest.mark.asyncio
async def test_skill_mounts_verified_tabular_source_object(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["cat", "{input_file}", "{greeting}"]}])
    actions_path = workspace.parent / "skills" / "100" / "resolved" / "actions.json"
    actions = json.loads(actions_path.read_text(encoding="utf-8"))
    actions["actions"][0]["parameters"].append({"name": "input_file", "description": "Source file."})
    actions_path.write_text(json.dumps(actions), encoding="utf-8")
    source_ref = "attachments/cases.csv"
    source_path = workspace / source_ref
    source_path.parent.mkdir(parents=True)
    source_path.write_bytes(b"Case ID\nTC-1\n")
    manifest = WorkspaceSourceService().index_path(workspace, source_ref, source_path)
    repository = WorkspaceSourceRepository(workspace)
    object_ref = repository.object_ref(manifest)
    object_path = repository.resolve_object_ref(object_ref)
    assert object_path is not None
    backend = _FakeBackend(CommandResult(return_code=0))
    executor = _skill_executor(workspace, tmp_path, backend)
    run = _skill_run(args={"input_file": object_ref})
    run.spec.metadata["tabular"] = {"source_ref": source_ref, "source_object_ref": object_ref}

    result = await executor.run(run, _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    (spec,) = backend.ran_specs
    assert spec.argv == ["cat", str(object_path), "hello"]
    source_mount = next(mount for mount in spec.mounts if mount.name == "source-input-0")
    assert source_mount.host_path == source_mount.mount_path == str(object_path.parent)
    assert source_mount.read_only


@pytest.mark.asyncio
async def test_skill_stops_on_first_failing_step(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(
        workspace,
        name="android-test",
        steps=[{"argv": ["echo", "{greeting}"]}, {"argv": ["echo", "second"]}],
    )
    backend = _FakeBackend(CommandResult(return_code=3, stderr="boom"), CommandResult(return_code=0))
    executor = _skill_executor(workspace, tmp_path, backend)

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.SKILL_RUNTIME
    assert len(backend.ran_specs) == 1  # second step never runs
    assert backend.close_calls == 1
    # The failing step's stderr is folded into the summary so it reaches the digest.
    assert "stderr:\nboom" in result.summary


@pytest.mark.asyncio
async def test_skill_summary_includes_stdout(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["echo", "{greeting}"]}])
    backend = _FakeBackend(CommandResult(return_code=0, stdout="hello world\n"))
    executor = _skill_executor(workspace, tmp_path, backend)

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert "finished" in result.summary
    assert "stdout:\nhello world" in result.summary


@pytest.mark.asyncio
async def test_skill_system_error_is_transient(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["echo", "{greeting}"]}])
    backend = _FakeBackend(CommandResult(return_code=-1, system_error="backend unavailable"))
    executor = _skill_executor(workspace, tmp_path, backend)

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.TRANSIENT
    assert "backend unavailable" in result.error_message


@pytest.mark.asyncio
async def test_skill_timeout_maps_to_timed_out(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["echo", "{greeting}"]}])
    backend = _FakeBackend(CommandResult(return_code=-1, system_error="command timed out after 5s"))
    executor = _skill_executor(workspace, tmp_path, backend)

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.TIMED_OUT
    assert result.error_class == ErrorClass.TIMEOUT


@pytest.mark.asyncio
async def test_skill_unknown_action_is_user_input_failure(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text("[]", encoding="utf-8")
    backend = _FakeBackend(CommandResult(return_code=0))
    executor = _skill_executor(workspace, tmp_path, backend)

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.USER_INPUT
    assert backend.open_calls == []


def test_skill_provider_requires_dependencies(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    loader = SkillLoader(workspace)
    with pytest.raises(ValueError, match="skill_loader is required"):
        SkillCapabilityProvider(None, artifact_store=_artifact_store(tmp_path), command_backend=_FakeBackend())  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="artifact_store is required"):
        SkillCapabilityProvider(loader, artifact_store=None, command_backend=_FakeBackend())  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="command_backend is required"):
        SkillCapabilityProvider(loader, artifact_store=_artifact_store(tmp_path), command_backend=None)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_skill_closes_session_even_when_run_raises(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["echo", "{greeting}"]}])

    async def _boom(_spec: CommandSpec) -> CommandResult:
        raise RuntimeError("exec exploded")

    class _RaisingBackend(_FakeBackend):
        def open_session(self, *, pod_name: str = "", image: str = ""):
            session = _FakeSession(self)
            session.run = _boom  # type: ignore[method-assign]
            return session

    raising = _RaisingBackend()
    executor = _skill_executor(workspace, tmp_path, raising)

    result = await executor.run(_skill_run(), _FakeStore())

    # The session is released, and the executor settles the run it claimed
    # rather than letting the fault escape as an exception.
    assert raising.close_calls == 1
    assert result.status == TaskStatus.FAILED
    assert "exec exploded" in result.error_message


@pytest.mark.asyncio
async def test_skill_artifact_includes_workspace_relative_filepath(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["write-result", "{greeting}"]}])

    class _WritingSession(_FakeSession):
        async def run(self, spec: CommandSpec) -> CommandResult:
            Path(spec.env["SICO_RESULT_DIR"], "out.txt").write_text("ok", encoding="utf-8")
            return await super().run(spec)

    class _WritingBackend(_FakeBackend):
        def open_session(self, *, pod_name: str = "", image: str = "") -> _WritingSession:
            self.open_calls.append({"pod_name": pod_name, "image": image})
            return _WritingSession(self)

    executor = _skill_executor(workspace, tmp_path, _WritingBackend())

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert result.primary_artifact is not None
    assert result.primary_artifact.name == "out.txt"
    assert result.primary_artifact.filepath == "results/batch-1/run-skill/result/out.txt"


@pytest.mark.asyncio
async def test_skill_collects_artifacts_when_step_fails(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, name="android-test", steps=[{"argv": ["write-result", "then-fail", "{greeting}"]}])

    class _FailingWritingSession(_FakeSession):
        async def run(self, spec: CommandSpec) -> CommandResult:
            Path(spec.env["SICO_RESULT_DIR"], "failure.txt").write_text("partial", encoding="utf-8")
            self._backend.ran_specs.append(spec)
            self._backend.runtime_file_seen = True
            return CommandResult(return_code=2, stderr="validation failed")

    class _FailingWritingBackend(_FakeBackend):
        def open_session(self, *, pod_name: str = "", image: str = "") -> _FailingWritingSession:
            self.open_calls.append({"pod_name": pod_name, "image": image})
            return _FailingWritingSession(self)

    executor = _skill_executor(workspace, tmp_path, _FailingWritingBackend())

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.FAILED
    assert result.error_class == ErrorClass.SKILL_RUNTIME
    assert result.primary_artifact is not None
    assert result.primary_artifact.name == "failure.txt"
    assert result.primary_artifact.filepath == "results/batch-1/run-skill/result/failure.txt"
    assert [artifact.name for artifact in result.artifacts] == ["failure.txt"]


@pytest.mark.skipif(sys.platform == "win32", reason="requires POSIX shell (sh)")
@pytest.mark.asyncio
async def test_skill_runs_for_real_via_local_backend(tmp_path) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(
        workspace,
        name="android-test",
        steps=[{"argv": ["sh", "-c", 'printf "%s" "{greeting}" > "$SICO_RESULT_DIR/out.txt"']}],
    )
    executor = _skill_executor(workspace, tmp_path, LocalBackend())

    result = await executor.run(_skill_run(), _FakeStore())

    assert result.status == TaskStatus.COMPLETED
    assert result.primary_artifact is not None
    assert result.primary_artifact.name == "out.txt"
    assert result.primary_artifact.filepath == "results/batch-1/run-skill/result/out.txt"


# --- Parameter projection helpers ----------------------------------------------


def _android_action(*param_names: str) -> ResolvedAction:
    argv = ["android-tester", "{sandbox.android}"]
    for name in param_names:
        argv += [f"--{name}", f"{{{name}}}"]
    return ResolvedAction(
        name="run_android_test_case",
        infra_requirements=["sandbox.android"],
        parameters=[ResolvedActionParameter(name=name) for name in param_names],
        steps=[ResolvedActionStep(argv=argv)],
    )


def _prep_run(action_name: str, *, args: dict, title: str = "", sandbox: SandboxLeaseRef | None = None) -> TaskRun:
    spec = TaskSpec(
        task_id="t-prep",
        title=title or "Prep run",
        dispatch=CapabilityDispatch(capability_id=f"skill:android-test.{action_name}"),
        args=args,
    )
    run = TaskRun(
        run_id="run-prep",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=7,
        project_id=11,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=spec.task_id,
        executor="local_subprocess",
        queued_at=0,
    )
    run.sandbox = sandbox
    return run


def test_sandbox_values_from_lease_maps_android_endpoint() -> None:
    action = _android_action("instructions")
    lease = SandboxLeaseRef(sandbox_id="sandbox-1", type="emulator", endpoint="127.0.0.1:16416", acquired_at=1)

    assert _sandbox_values_from_lease(action, lease) == {
        "_sandbox": "127.0.0.1:16416",
        "sandbox.android": "127.0.0.1:16416",
    }


def test_sandbox_values_from_lease_rejects_mismatched_type() -> None:
    # With only one sandbox type (emulator), we test that a lease whose type
    # does NOT appear in eligible_types_for_os is rejected. We achieve this by
    # using an action with a non-existent infra requirement.
    action = ResolvedAction(
        name="bogus_action",
        infra_requirements=["sandbox.bogus"],
        steps=[ResolvedActionStep(argv=["echo", "test"])],
        parameters=[],
    )
    lease = SandboxLeaseRef(sandbox_id="sandbox-1", type="emulator", endpoint="127.0.0.1:16416", acquired_at=1)

    with pytest.raises(ValueError, match="requires a compatible sandbox"):
        _sandbox_values_from_lease(action, lease)


def test_normalize_invocation_parameters_fills_android_context() -> None:
    action = _android_action("device_id", "instructions", "task_name")

    parameters = _normalize_invocation_parameters(
        action,
        {
            "sandbox.android": "127.0.0.1:16416",
            "case_id": "row-1",
            "playbook_hints": [{"id": "android-1"}],
            "sheet_name": "Cases",
        },
        task_context={
            "instructions": "Open Edge and visit Baidu.",
            "task_id": "row-1",
            "task_name": "Open Edge, visit Baidu, and quit on Android",
            "title": "Open Edge, visit Baidu, and quit on Android",
        },
        filter_task_context=True,
    )

    assert parameters == {
        "sandbox.android": "127.0.0.1:16416",
        "device_id": "127.0.0.1:16416",
        "instructions": "Open Edge and visit Baidu.",
        "task_name": "Open Edge, visit Baidu, and quit on Android",
    }


def test_prepare_parameters_injects_lease_and_normalizes_context() -> None:
    action = _android_action("device_id", "instructions", "task_name")
    lease = SandboxLeaseRef(sandbox_id="sandbox-1", type="emulator", endpoint="127.0.0.1:16416", acquired_at=1)
    run = _prep_run(
        "run_android_test_case",
        args={"instructions": "Open Edge.", "case_id": "row-1"},
        title="Open Edge on Android",
        sandbox=lease,
    )

    parameters = _prepare_parameters(action, run, run.spec.args)

    assert parameters == {
        "_sandbox": "127.0.0.1:16416",
        "sandbox.android": "127.0.0.1:16416",
        "device_id": "127.0.0.1:16416",
        "instructions": "Open Edge.",
        "task_name": "Open Edge on Android",
    }


def test_prepare_parameters_reports_missing_required() -> None:
    action = _android_action("instructions", "task_name")
    lease = SandboxLeaseRef(sandbox_id="sandbox-1", type="emulator", endpoint="127.0.0.1:16416", acquired_at=1)
    run = _prep_run("run_android_test_case", args={}, sandbox=lease)

    with pytest.raises(ValueError, match=r"missing required parameters"):
        _prepare_parameters(action, run, run.spec.args)


def test_prepare_parameters_rejects_unsupported_infra() -> None:
    action = ResolvedAction(
        name="run",
        infra_requirements=["sandbox.unknown"],
        parameters=[ResolvedActionParameter(name="instructions")],
        steps=[ResolvedActionStep(argv=["tester", "{sandbox.unknown}", "{instructions}"])],
    )
    run = _prep_run("run", args={"instructions": "go"})

    with pytest.raises(ValueError, match="unsupported infra requirements"):
        _prepare_parameters(action, run, run.spec.args)
