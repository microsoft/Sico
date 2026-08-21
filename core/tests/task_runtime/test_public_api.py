from __future__ import annotations

import ast
from pathlib import Path

import app.biz.task_runtime as task_runtime
import app.biz.task_runtime.planning as planning
from app.biz.chat.preparation import catalogue as preparation_catalogue
from app.biz.chat.preparation import service as preparation_service
from app.biz.task_runtime import manager


_EXPECTED_PUBLIC_API = {
    "ALL_CAPABILITIES",
    "AgentProfile",
    "AgentProfileResolver",
    "ArtifactRef",
    "BatchRecord",
    "BatchResult",
    "BatchResultDigest",
    "BatchStatus",
    "CapabilityBinding",
    "CapabilityContext",
    "CapabilityDescriptor",
    "CapabilityHandler",
    "CapabilityProvider",
    "CatalogueQuery",
    "ErrorClass",
    "Executor",
    "ProfileDescriptor",
    "ProfileQuery",
    "ProfileVisibilityPolicy",
    "ResolveContext",
    "RunStore",
    "StaticAgentProfileResolver",
    "TaskManager",
    "TaskResult",
    "TaskResultDigest",
    "TaskRun",
    "TaskSpec",
    "TaskStatus",
    "cancel_turn_task_runtime_once",
    "compute_idempotency_key",
    "default_agent_profile_resolver",
    "default_task_manager",
    "reconcile_stale_task_runtime_once",
    "run_task_runtime_startup_reconciler",
    "set_task_manager_factory",
}

_EXPECTED_PLANNING_API = {
    "CapabilityCard",
    "CapabilityDescriptor",
    "CapabilityDispatch",
    "CatalogueQuery",
    "Dispatch",
    "JoinStrategy",
    "PreparedTaskBatch",
    "ProfileDescriptor",
    "ProfileQuery",
    "RUNTIME_TOOLS",
    "RUNTIME_TOOL_NAMES",
    "ResolveContext",
    "SANDBOX_OSES",
    "SubAgentDispatch",
    "TaskBatchInput",
    "TaskSpec",
    "builtin_capability_id",
    "builtin_descriptors",
    "ceiling_allows",
    "normalize_capability_id",
    "normalize_sandbox_hint",
    "profile_descriptor_payload",
    "render_runtime_tool_catalog",
    "runtime_tool_names_inline",
    "skill_capability_id",
    "skill_descriptors",
}

_EXPECTED_MANAGER_API = {
    "PlanCancellationRequested",
    "TaskManager",
    "cancel_turn_task_runtime_once",
}


def test_task_runtime_public_api_is_stable() -> None:
    assert set(task_runtime.__all__) == _EXPECTED_PUBLIC_API
    assert all(getattr(task_runtime, name, None) is not None for name in _EXPECTED_PUBLIC_API)


def test_task_runtime_planning_api_is_stable() -> None:
    assert set(planning.__all__) == _EXPECTED_PLANNING_API
    assert all(getattr(planning, name, None) is not None for name in _EXPECTED_PLANNING_API)


def test_chat_preparation_uses_only_public_task_runtime_boundaries() -> None:
    allowed = {"app.biz.task_runtime", "app.biz.task_runtime.planning"}
    for module in (preparation_catalogue, preparation_service):
        imports = _task_runtime_imports(module)
        assert imports <= allowed, f"{module.__name__} reaches into task_runtime internals: {imports - allowed}"


def test_manager_does_not_import_the_composition_factory() -> None:
    assert "app.biz.task_runtime.factory" not in _resolved_imports(manager)


def test_manager_public_api_is_facade_only() -> None:
    assert set(manager.__all__) == _EXPECTED_MANAGER_API


def _task_runtime_imports(module: object) -> set[str]:
    return {name for name in _resolved_imports(module) if name.startswith("app.biz.task_runtime")}


def _resolved_imports(module: object) -> set[str]:
    module_name = str(getattr(module, "__name__"))
    module_path = Path(str(getattr(module, "__file__")))
    tree = ast.parse(module_path.read_text(encoding="utf-8"))
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                package = module_name.rsplit(".", node.level)[0]
                imports.add(f"{package}.{node.module}" if node.module else package)
            elif node.module:
                imports.add(node.module)
    return imports
