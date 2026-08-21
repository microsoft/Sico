"""The skill capability provider.

:class:`~app.biz.task_runtime.capabilities.loader.SkillLoader` already answers both
provider questions — it lists capability cards (*catalogue*) and loads a
resolved action (*binding*) — so this module is the adapter that projects those
onto the capability contract, plus the handler that actually runs an action's
pre-resolved argv steps in **one** per-run :class:`CommandSession`.

What this provider intentionally does NOT do: **acquire or release** sandbox
leases. By the time a run reaches here ``SandboxCoordinator`` has already leased
any required sandbox (``run.sandbox``); the handler only *projects* that lease
into the action parameters/env, normalises and validates the parameters, then
runs the steps.

Every skill capability declares ``effect="mutate"`` unless its author says
otherwise. Existing ``actions.json`` files carry no effect declaration at all, so
the conservative projection happens **here**, inside the provider — the
descriptor itself keeps ``effect`` mandatory and default-free, because a default
is exactly how an unobserved mutation would slip through.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..storage.artifact_store import ArtifactStore
from ..domain.models import ArtifactRef, ErrorClass, SandboxLeaseRef, TaskResult, TaskRun, TaskStatus
from ..execution.naming import sanitize_dns_label
from ..domain.results import build_user_input_result
from ..sandbox.types import (
    InfraRequirement,
    eligible_types_for_os,
    sandbox_for_requirement,
)
from .loader import SkillLoader
from ..domain.time import now_ms as _now_ms
from ..execution.command.contracts import (
    CommandBackend,
    CommandMount,
    CommandResult,
    CommandSpec,
    readonly_input_mounts,
    truncate_stream,
)
from .catalogue import skill_descriptor, skill_descriptors
from .descriptors import (
    CapabilityBinding,
    CapabilityContext,
    CapabilityDescriptor,
    CatalogueQuery,
    ResolveContext,
)
from .ids import SKILL_PROVIDER_ID, skill_action_of

if TYPE_CHECKING:
    from app.biz.skill.resolver import ResolvedAction, ResolvedActionStep

_WORKSPACE_MOUNT_NAME = "workspace"
_RUNTIME_MOUNT_NAME = "skill-runtime"
_RESULT_MOUNT_NAME = "skill-result"
_STDOUT_HEAD = 1000
_STDERR_HEAD = 500

_SANDBOX_PLACEHOLDER = "_sandbox"
_ANDROID_SANDBOX_PARAMETER_ALIASES = ("device_id", "android_device_id", "adb_endpoint")
_TASK_CONTEXT_PARAMETER_NAMES = frozenset(
    {
        "case",
        "case_id",
        "data_row_index",
        "instructions",
        "playbook_hints",
        "playbook_shown_bullet_ids",
        "sheet_name",
        "source_row",
        "task_id",
        "task_name",
        "timeout_seconds",
        "title",
    }
)


class SkillCapabilityProvider:
    """Serves registered skill actions as capabilities."""

    provider_id = SKILL_PROVIDER_ID

    def __init__(
        self,
        skill_loader: SkillLoader,
        *,
        artifact_store: ArtifactStore,
        command_backend: CommandBackend,
    ) -> None:
        if skill_loader is None:
            raise ValueError("skill_loader is required")
        if artifact_store is None:
            raise ValueError("artifact_store is required")
        if command_backend is None:
            raise ValueError("command_backend is required")
        self.skill_loader = skill_loader
        self.artifact_store = artifact_store
        self.command_backend = command_backend

    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        cards = self.skill_loader.list_cards(visibility="any" if query.include_internal else "public")
        return tuple(descriptor for descriptor in skill_descriptors(cards) if query.matches(descriptor))

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding | None:
        skill_name, action_name = skill_action_of(capability_id)
        if not skill_name or not action_name:
            return None
        card = self.skill_loader.resolve(f"{skill_name}.{action_name}")
        if card is None or not card.is_executable:
            return None
        return CapabilityBinding(descriptor=skill_descriptor(card), handler=_SkillHandler(self, skill_name, action_name))


class _SkillHandler:
    """Runs a resolved skill action's steps in one per-run sandbox session."""

    def __init__(self, provider: SkillCapabilityProvider, skill_name: str, action_name: str) -> None:
        self._provider = provider
        self._skill_name = skill_name
        self._action_name = action_name

    async def execute(self, context: CapabilityContext) -> TaskResult:
        run = context.run
        resolved = self._provider.skill_loader.load_action(self._skill_name, self._action_name)
        if resolved is None:
            return build_user_input_result(run, f"No executable action found for skill: {self._skill_name}.{self._action_name}")

        try:
            parameters = _prepare_parameters(resolved.action, run, context.arguments)
        except ValueError as exc:
            return build_user_input_result(run, str(exc))

        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        outcome = CommandResult(return_code=0)
        run_runtime_root: Path | None = None
        try:
            try:
                run_runtime_root = _prepare_run_runtime(resolved.runtime_root, context.run_dir)
                specs = _build_step_specs(context, resolved.action, run_runtime_root, parameters)
            except ValueError as exc:
                return build_user_input_result(run, str(exc))

            session = self._provider.command_backend.open_session(
                pod_name=_skill_pod_name(run), image=str(context.arguments.get("image") or "")
            )
            try:
                for spec in specs:
                    outcome = await session.run(spec)
                    stdout_parts.append(outcome.stdout)
                    stderr_parts.append(outcome.stderr or outcome.system_error)
                    if outcome.system_error or outcome.return_code != 0:
                        break
            finally:
                await session.aclose()
        finally:
            _cleanup_run_runtime(run_runtime_root)

        return self._build_result(context, outcome, "".join(stdout_parts), "".join(stderr_parts))

    def _build_result(
        self,
        context: CapabilityContext,
        outcome: CommandResult,
        stdout: str,
        stderr: str,
    ) -> TaskResult:
        run = context.run
        finished_at = _now_ms()
        label = f"{self._skill_name}.{self._action_name}"
        timed_out = outcome.return_code == -1 and "timed out" in outcome.system_error.lower()
        if timed_out:
            status = TaskStatus.TIMED_OUT
        elif outcome.system_error or outcome.return_code != 0:
            status = TaskStatus.FAILED
        else:
            status = TaskStatus.COMPLETED

        error_class: ErrorClass | None = None
        error_message = ""
        if status == TaskStatus.TIMED_OUT:
            error_class = ErrorClass.TIMEOUT
            error_message = outcome.system_error or f"{label} timed out"
        elif status == TaskStatus.FAILED:
            error_class = ErrorClass.TRANSIENT if outcome.system_error else ErrorClass.SKILL_RUNTIME
            error_message = outcome.system_error or stderr or f"{label} exited with {outcome.return_code}"

        artifacts = self._collect_artifacts(run.run_id, context.result_dir, context.workspace)
        return TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=status,
            title=run.spec.title,
            summary=_build_summary(label, status, stdout, stderr),
            output=stdout,
            primary_artifact=artifacts[0] if artifacts else None,
            artifacts=artifacts,
            error_class=error_class,
            error_message=error_message,
            sandbox=run.sandbox,
            started_at=context.started_at,
            ended_at=finished_at,
            duration_ms=max(0, finished_at - context.started_at),
        )

    def _collect_artifacts(self, run_id: str, result_root: Path, workspace: Path) -> list[ArtifactRef]:
        artifacts: list[ArtifactRef] = []
        for path in sorted(p for p in result_root.rglob("*") if p.is_file()):
            artifact = self._provider.artifact_store.put(run_id, path.name, path, artifact_type="file", role="primary")
            artifact.filepath = _workspace_relative_path(path, workspace)
            artifacts.append(artifact)
        return artifacts


def _build_summary(label: str, status: TaskStatus, stdout: str, stderr: str) -> str:
    # Fold the action's output into the summary so the caller sees it via the
    # batch digest (which only carries ``summary``), not just a status label.
    lines = [f"{label} {'finished' if status == TaskStatus.COMPLETED else 'failed'}"]
    trimmed_stdout = truncate_stream(stdout, _STDOUT_HEAD)
    if trimmed_stdout:
        lines.append(f"stdout:\n{trimmed_stdout}")
    if status != TaskStatus.COMPLETED:
        trimmed_stderr = truncate_stream(stderr, _STDERR_HEAD)
        if trimmed_stderr:
            lines.append(f"stderr:\n{trimmed_stderr}")
    return "\n".join(lines)


def _prepare_parameters(action: ResolvedAction, run: TaskRun, arguments: Mapping[str, Any]) -> dict[str, Any]:
    """Project the call's arguments + sandbox lease into validated action parameters.

    Sandbox *acquisition* already happened in ``SandboxCoordinator``
    (``run.sandbox``); here we only inject the leased endpoint, normalise
    task-context defaults, and validate required/unknown names. Raises
    ``ValueError`` with a user-facing message so the caller can surface a
    deterministic user-input failure.
    """
    unsupported = sorted(r for r in action.infra_requirements if sandbox_for_requirement(r) is None)
    if unsupported:
        raise ValueError(f"unsupported infra requirements: {unsupported}")
    parameters = dict(arguments)
    parameters.update(_sandbox_values_from_lease(action, run.sandbox))
    parameters = _normalize_invocation_parameters(
        action, parameters, task_context=_skill_task_context(run), filter_task_context=True
    )
    error = _validate_parameters(action, parameters)
    if error:
        raise ValueError(error)
    return parameters


def _skill_task_context(run: TaskRun) -> dict[str, Any]:
    return {
        "instructions": run.spec.instructions,
        "task_id": run.spec.task_id,
        "task_name": run.spec.title,
        "title": run.spec.title,
    }


def _sandbox_values_from_lease(action: ResolvedAction, sandbox_lease: SandboxLeaseRef | None) -> dict[str, str]:
    """Project one leased endpoint into every acceptable sandbox placeholder."""
    if sandbox_lease is None:
        return {}
    supported_requirements: list[tuple[str, str]] = []
    matching_requirements: list[str] = []
    for requirement in action.infra_requirements:
        required_os = sandbox_for_requirement(requirement)
        if required_os is None:
            continue
        supported_requirements.append((requirement, required_os))
        if sandbox_lease.os == required_os or (not sandbox_lease.os and sandbox_lease.type in eligible_types_for_os(required_os)):
            matching_requirements.append(requirement)
    if action.infra_requirements and not matching_requirements:
        if len(supported_requirements) == 1:
            requirement, required_os = supported_requirements[0]
            raise ValueError(f"{requirement} requires a {required_os} sandbox, got {sandbox_lease.type}")
        requirements = ", ".join(action.infra_requirements)
        raise ValueError(f"{requirements} requires a compatible sandbox, got {sandbox_lease.type}")
    endpoint = _sandbox_lease_endpoint(sandbox_lease)
    if action.infra_requirements and not endpoint:
        raise ValueError("sandbox lease is missing endpoint")
    values: dict[str, str] = {_SANDBOX_PLACEHOLDER: endpoint} if endpoint else {}
    for requirement in action.infra_requirements:
        values[requirement] = endpoint
    return values


def _sandbox_lease_endpoint(sandbox_lease: SandboxLeaseRef) -> str:
    if sandbox_lease.type == "emulator":
        endpoint = (sandbox_lease.endpoint or sandbox_lease.device_id).strip()
    else:
        endpoint = (sandbox_lease.provider_base_url or sandbox_lease.endpoint or sandbox_lease.device_id).strip()
    if not endpoint.startswith("/"):
        return endpoint
    base = (os.getenv("SICO_ENDPOINT") or "").strip().rstrip("/")
    return base + endpoint if base else endpoint


def _normalize_invocation_parameters(
    action: ResolvedAction,
    parameters: dict[str, Any],
    *,
    task_context: dict[str, Any] | None = None,
    filter_task_context: bool = False,
) -> dict[str, Any]:
    normalized = dict(parameters)
    parameter_names = {parameter.name for parameter in action.parameters}
    if task_context:
        for name, value in task_context.items():
            if name in parameter_names:
                _setdefault_nonempty(normalized, name, value)
        _setdefault_nonempty(normalized, "task_name", task_context.get("task_name") or task_context.get("title"))
    if InfraRequirement.ANDROID in action.infra_requirements:
        endpoint = normalized.get(InfraRequirement.ANDROID)
        for alias in _ANDROID_SANDBOX_PARAMETER_ALIASES:
            if alias in parameter_names:
                _setdefault_nonempty(normalized, alias, endpoint)
    if filter_task_context:
        known = parameter_names | set(action.infra_requirements) | {_SANDBOX_PLACEHOLDER}
        for name in list(normalized):
            if name in _TASK_CONTEXT_PARAMETER_NAMES and name not in known:
                normalized.pop(name, None)
    return normalized


def _setdefault_nonempty(parameters: dict[str, Any], name: str, value: Any) -> None:
    if name not in parameters or not _is_nonempty_value(parameters.get(name)):
        if _is_nonempty_value(value):
            parameters[name] = value


def _is_nonempty_value(value: Any) -> bool:
    return value is not None and (not isinstance(value, str) or bool(value.strip()))


def _validate_parameters(action: ResolvedAction, parameters: dict[str, Any]) -> str:
    from app.biz.skill.resolver import infer_required_parameter_names

    known = {parameter.name for parameter in action.parameters} | set(action.infra_requirements) | {_SANDBOX_PLACEHOLDER}
    required = infer_required_parameter_names(action)
    missing = sorted(name for name in required if name not in parameters)
    if missing:
        return f"missing required parameters: {missing}"
    unknown = sorted(name for name in parameters if name not in known)
    if unknown:
        return f"unknown parameters: {unknown}"
    return ""


def _build_step_specs(
    context: CapabilityContext,
    action: ResolvedAction,
    runtime_root: Path,
    parameters: dict[str, Any],
) -> list[CommandSpec]:
    from app.biz.skill.resolver import infer_optional_parameter_names

    run = context.run
    workspace = context.workspace
    result_root = context.result_dir
    optional_names = infer_optional_parameter_names(action)
    path_placeholders = {"workspace_dir": str(workspace), "result_dir": str(result_root)}
    env = _step_env(run, workspace, result_root)
    mounts = [
        CommandMount(
            name=_WORKSPACE_MOUNT_NAME,
            host_path=str(workspace),
            mount_path=str(workspace),
            read_only=not context.descriptor.workspace_is_writable,
        ),
        CommandMount(name=_RUNTIME_MOUNT_NAME, host_path=str(runtime_root), mount_path=str(runtime_root)),
        CommandMount(name=_RESULT_MOUNT_NAME, host_path=str(result_root), mount_path=str(result_root)),
        *readonly_input_mounts(context.input_paths),
    ]
    timeout_seconds = run.execution_policy.timeout_seconds
    metadata = {
        "agent_instance_id": str(run.agent_instance_id),
        "user_label": sanitize_dns_label(run.username, max_len=63),
    }
    specs: list[CommandSpec] = []
    for step in action.steps:
        argv = _build_step_argv(step, parameters, path_placeholders, optional_names)
        # cwd == mount_path == the host-visible runtime path keeps the working
        # directory identical across backends: the local backend cd's to it on
        # the host, while container backends bind-mount the (host-translated)
        # runtime at the same path and cd there inside the sandbox.
        cwd = _step_cwd(runtime_root, step.cwd)
        specs.append(
            CommandSpec(
                argv=argv,
                cwd=str(cwd),
                env=env,
                mounts=mounts,
                timeout_seconds=timeout_seconds,
                metadata=metadata,
            )
        )
    return specs


def _prepare_run_runtime(runtime_root: Path, run_root: Path) -> Path:
    run_runtime_root = run_root / "runtime"
    if run_runtime_root.exists():
        shutil.rmtree(run_runtime_root)
    run_runtime_root.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(runtime_root, run_runtime_root)
    except Exception:
        _cleanup_run_runtime(run_runtime_root)
        raise
    return run_runtime_root


def _cleanup_run_runtime(run_runtime_root: Path | None) -> None:
    if run_runtime_root is not None and run_runtime_root.exists():
        shutil.rmtree(run_runtime_root)


def _step_env(run: TaskRun, workspace: Path, result_root: Path) -> dict[str, str]:
    """Per-run env overlay for a skill step.

    Only SICO_* identity/path vars are declared; the local backend merges these
    over ``os.environ`` and container backends forward them as ``-e``/pod env, so
    the set is intentionally small (no host environment leakage into containers).
    """
    env = {
        "SICO_TASK_RUN_ID": run.run_id,
        "SICO_AGENT_INSTANCE_ID": str(run.agent_instance_id),
        "SICO_PROJECT_ID": str(run.project_id),
        "SICO_APP_NAME": os.getenv("SICO_APP_NAME", "sico").strip() or "sico",
        "SICO_WORKSPACE_DIR": str(workspace),
        "SICO_RESULT_DIR": str(result_root),
    }
    if endpoint := os.getenv("SICO_ENDPOINT"):
        env["SICO_ENDPOINT"] = endpoint
    return env


def _build_step_argv(
    step: ResolvedActionStep,
    parameters: dict[str, Any],
    path_placeholders: dict[str, str],
    optional_parameter_names: set[str],
) -> list[str]:
    argv = [_substitute_placeholders(item, parameters, path_placeholders) for item in step.argv]
    for group in step.optional_argv:
        group_optional_names = {name for value in group for name in optional_parameter_names if "{" + name + "}" in str(value)}
        if group_optional_names and all(_has_parameter_value(parameters, name) for name in group_optional_names):
            argv.extend(_substitute_placeholders(item, parameters, path_placeholders) for item in group)
    return argv


def _substitute_placeholders(value: Any, parameters: dict[str, Any], path_placeholders: dict[str, str]) -> str:
    text = str(value)
    for key, parameter_value in {**parameters, **path_placeholders}.items():
        text = text.replace("{" + key + "}", str(parameter_value))
    return text


def _has_parameter_value(parameters: dict[str, Any], name: str) -> bool:
    value = parameters.get(name)
    return value is not None and (not isinstance(value, str) or bool(value.strip()))


def _step_cwd(runtime_root: Path, cwd: str) -> Path:
    from app.biz.skill.resolver import validate_relative_path

    validate_relative_path(cwd, allow_dot=True)
    return runtime_root if cwd in ("", ".") else runtime_root / cwd


def _skill_pod_name(run: TaskRun) -> str:
    return sanitize_dns_label(f"skill-{run.run_id}", max_len=63)


def _workspace_relative_path(path: Path, workspace: Path) -> str:
    try:
        return path.resolve().relative_to(workspace.resolve()).as_posix()
    except ValueError:
        return ""
