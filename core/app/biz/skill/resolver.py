from __future__ import annotations

import json
import logging
import os
import re
import difflib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.storage.fs import parse_skill_frontmatter

_LOGGER = logging.getLogger(__name__)

ORIGINAL_DIR = "original"
RESOLVED_DIR = "resolved"
RESOLVED_CORTEX_DIR = "resolved/cortex"
RESOLVED_ACTIONS_FILE = "resolved/actions.json"
RESOLVED_ACTIONS_PROPOSAL_FILE = "resolved/actions.proposal.json"
RESOLVED_ACTIONS_STATUS_FILE = "resolved/actions.status.json"
RESOLVED_STATUS_FILE = "status.json"
ACTION_MANIFEST_SCHEMA_VERSION = 3

_MAX_MARKDOWN_BYTES = 64 * 1024
_MAX_TOTAL_MARKDOWN_BYTES = 192 * 1024
_MAX_SCRIPT_BYTES = 48 * 1024
_MAX_FULL_SCRIPT_BYTES = 5 * 1024
_MAX_DIFF_FILE_BYTES = 48 * 1024
_MAX_TOTAL_DIFF_BYTES = 96 * 1024
_MAX_RESOLVER_ATTEMPTS = 3
_DEFAULT_RUNNER_COMMANDS_ENV = "TASK_RUNTIME_DEFAULT_RUNNER_COMMANDS"
_KNOWN_DEFAULT_RUNNER_COMMANDS = ("apk", "python", "sh", "uv")
_IMPORTANT_SCRIPT_FILENAMES = {
    "main.py",
    "config.py",
    "pyproject.toml",
    "package.json",
    "Makefile",
    "makefile",
}
_IMPORTANT_SCRIPT_SUFFIXES = {"/__main__.py", "/main.py", "/config.py"}
_SCRIPT_FILE_SUFFIXES = {
    ".bash",
    ".js",
    ".jsx",
    ".mjs",
    ".ps1",
    ".py",
    ".rb",
    ".sh",
    ".ts",
    ".tsx",
    ".zsh",
}
_PLACEHOLDER_RE = re.compile(r"\{([^{}]+)\}")
_SANDBOX_PLACEHOLDER = "_sandbox"
_GENERATED_SANDBOX_PLACEHOLDERS = frozenset(
    {"sandbox.android", "sandbox.windows", "sandbox.macos", "sandbox.ios", "sandbox.linux"}
)
_BUILT_IN_STEP_PLACEHOLDERS = {"workspace_dir", "result_dir", _SANDBOX_PLACEHOLDER}
STRICT_SCHEMA_CONFIG = ConfigDict(extra="forbid")
_PLATFORM_MANAGED_PARAMETER_NAMES = frozenset(
    {
        "sico_agent_instance_id",
        "sico_app_name",
        "sico_endpoint",
    }
)


class ResolvedCortexFile(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    name: str = Field(description="Resolved cortex file path, usually SKILL.md.")


class ResolvedActionParameter(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    name: str
    description: str = Field(default="", description="User-facing parameter help text. Do not use placeholders.")
    type: Literal["string", "integer", "number", "boolean", "array", "object"] = "string"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("parameter name is required")
        if value.lower() in _PLATFORM_MANAGED_PARAMETER_NAMES:
            raise ValueError(f"{value} is injected by the invoke_skill runtime and must not be an action parameter")
        return value

    @field_validator("description")
    @classmethod
    def description_has_no_placeholders(cls, value: str) -> str:
        if "{" in value and "}" in value:
            raise ValueError("parameter description must not contain placeholders")
        return value


class ResolvedActionStep(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    argv: list[str] = Field(description="Command argv. Placeholders are substituted per item before execution.")
    optional_argv: list[list[str]] = Field(
        default_factory=list,
        description="Optional argv groups appended only when all referenced optional parameters are provided.",
    )
    cwd: str = Field(default="", description="Optional cwd relative to the copied runtime folder.")

    @field_validator("argv")
    @classmethod
    def argv_not_empty(cls, value: list[str]) -> list[str]:
        cleaned = [str(item) for item in value if str(item)]
        if not cleaned:
            raise ValueError("argv must not be empty")
        return cleaned

    @field_validator("optional_argv")
    @classmethod
    def optional_argv_groups_not_empty(cls, value: list[list[str]]) -> list[list[str]]:
        cleaned_groups: list[list[str]] = []
        for group in value:
            cleaned = [str(item) for item in group if str(item)]
            if not cleaned:
                raise ValueError("optional_argv groups must not be empty")
            cleaned_groups.append(cleaned)
        return cleaned_groups


class ResolvedActionOutput(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    name: str
    description: str = ""
    type: Literal["string", "integer", "number", "boolean", "array", "object", "file", "directory"] = "string"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("output name is required")
        return value


class ResolvedExecutionRequirement(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    backend: Literal["any", "local", "docker", "kubernetes", "linux_workstation"] = "any"
    image: str = ""


class ResolvedPreparation(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    steps: list[ResolvedActionStep] = Field(default_factory=list)

    @field_validator("steps")
    @classmethod
    def steps_are_invocation_independent(cls, value: list[ResolvedActionStep]) -> list[ResolvedActionStep]:
        for step in value:
            if step.optional_argv:
                raise ValueError("preparation steps must not have optional argv")
            placeholders = sorted(_placeholder_names(step.argv))
            if placeholders:
                raise ValueError(f"preparation steps must not use placeholders: {placeholders}")
        return value


class ResolvedTargetRequirements(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    type: Literal["", "linux_workstation"] = ""
    os: Literal["", "android", "windows", "macos", "ios", "linux"] = ""


class ResolvedActionLimits(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    timeout_seconds: int | None = Field(default=None, gt=0)
    max_output_bytes: int | None = Field(default=None, gt=0)


class ResolvedAction(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    name: str
    description: str = Field(default="", description="User-facing action description. Do not use placeholders.")
    infra_requirements: list[str] = Field(default_factory=list)
    parameters: list[ResolvedActionParameter] = Field(default_factory=list)
    outputs: list[ResolvedActionOutput] = Field(default_factory=list)
    workspace_access: Literal["none", "read_only", "read_write"] = "read_write"
    effect: Literal["read", "mutate"] = "mutate"
    execution_requirement: ResolvedExecutionRequirement = Field(default_factory=ResolvedExecutionRequirement)
    preparation: ResolvedPreparation = Field(default_factory=ResolvedPreparation)
    target_requirements: ResolvedTargetRequirements = Field(default_factory=ResolvedTargetRequirements)
    limits: ResolvedActionLimits = Field(default_factory=ResolvedActionLimits)
    named_secret_requirements: list[str] = Field(default_factory=list)
    steps: list[ResolvedActionStep] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("action name is required")
        return value

    @field_validator("description")
    @classmethod
    def description_has_no_placeholders(cls, value: str) -> str:
        if "{" in value and "}" in value:
            raise ValueError("action description must not contain placeholders")
        return value

    @field_validator("infra_requirements")
    @classmethod
    def infra_requirements_are_strings(cls, value: list[str]) -> list[str]:
        requirements: list[str] = []
        seen: set[str] = set()
        for item in value:
            requirement = str(item).strip()
            if requirement and requirement not in seen:
                requirements.append(requirement)
                seen.add(requirement)
        return requirements

    @field_validator("parameters")
    @classmethod
    def parameter_names_are_unique(cls, value: list[ResolvedActionParameter]) -> list[ResolvedActionParameter]:
        names = [parameter.name for parameter in value]
        if len(names) != len(set(names)):
            raise ValueError("parameter names must be unique")
        return value

    @field_validator("outputs")
    @classmethod
    def output_names_are_unique(cls, value: list[ResolvedActionOutput]) -> list[ResolvedActionOutput]:
        names = [output.name for output in value]
        if len(names) != len(set(names)):
            raise ValueError("output names must be unique")
        return value

    @field_validator("named_secret_requirements")
    @classmethod
    def secret_names_are_unique(cls, value: list[str]) -> list[str]:
        names = [str(name).strip() for name in value if str(name).strip()]
        if len(names) != len(set(names)):
            raise ValueError("named secret requirements must be unique")
        return names

    @model_validator(mode="after")
    def steps_not_empty(self) -> ResolvedAction:
        if not self.steps:
            raise ValueError("action steps are required")
        parameter_names = {parameter.name for parameter in self.parameters}
        valid_placeholders = parameter_names | set(self.infra_requirements) | _BUILT_IN_STEP_PLACEHOLDERS
        used_placeholders: set[str] = set()
        for step in self.steps:
            used_placeholders.update(_placeholder_names(step.argv))
            invalid_argv_placeholders = sorted(_placeholder_names(step.argv) - valid_placeholders)
            if invalid_argv_placeholders:
                raise ValueError(f"unsupported placeholders in argv: {invalid_argv_placeholders}")
            for group in step.optional_argv:
                used_placeholders.update(_placeholder_names(group))
                invalid_optional_placeholders = sorted(_placeholder_names(group) - valid_placeholders)
                if invalid_optional_placeholders:
                    raise ValueError(f"unsupported placeholders in optional_argv: {invalid_optional_placeholders}")
        unused_parameters = sorted(parameter_names - used_placeholders)
        if unused_parameters:
            raise ValueError(f"unused parameters: {unused_parameters}")
        if _SANDBOX_PLACEHOLDER in used_placeholders and not self.infra_requirements:
            raise ValueError(f"{_SANDBOX_PLACEHOLDER} requires sandbox infra_requirements")
        return self


class ResolvedSkillOutput(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    cortex: list[ResolvedCortexFile] = Field(default_factory=list)
    actions: list[ResolvedAction] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_names(self) -> ResolvedSkillOutput:
        action_names = [action.name for action in self.actions]
        if len(action_names) != len(set(action_names)):
            raise ValueError("action names must be unique")
        cortex_names = [item.name for item in self.cortex]
        if len(cortex_names) != len(set(cortex_names)):
            raise ValueError("cortex file names must be unique")
        return self


class ResolvedActionsManifest(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    schema_version: int = ACTION_MANIFEST_SCHEMA_VERSION
    review_status: Literal["proposed", "accepted"] = "accepted"
    source_provenance: Literal["author", "resolver", "legacy"] = "author"
    actions: list[ResolvedAction] = Field(default_factory=list)

    @field_validator("actions")
    @classmethod
    def action_names_are_unique(cls, value: list[ResolvedAction]) -> list[ResolvedAction]:
        names = [action.name for action in value]
        if len(names) != len(set(names)):
            raise ValueError("action names must be unique")
        return value

    @classmethod
    def from_pb(cls, actions: list[object]) -> ResolvedActionsManifest:
        items: list[ResolvedAction] = []
        for action in actions:
            name = str(getattr(action, "name", "") or "")
            description = str(getattr(action, "description", "") or "")
            settings: dict[str, object] = {}
            advanced_settings = str(getattr(action, "advanced_settings", "") or "").strip()
            if advanced_settings:
                payload = json.loads(advanced_settings)
                if not isinstance(payload, dict):
                    raise ValueError("advanced_settings must be a JSON object")
                settings.update(payload)
            settings["name"] = name
            settings["description"] = description
            items.append(ResolvedAction.model_validate(settings))
        return cls(actions=items)


class SkillResolverDiagnostics(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    status: str
    message: str = ""
    fallback_to_original: bool = False


class ActionReadiness(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    action_name: str = ""
    status: Literal["proposed", "accepted", "invalid", "environment_building", "ready", "unavailable"]
    message: str = ""


class ActionsAdmissionDiagnostics(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    status: Literal["proposed", "accepted", "invalid", "unavailable"]
    source_provenance: Literal["author", "resolver", "legacy"]
    message: str = ""
    actions: list[ActionReadiness] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ResolverExecutionEnvironment:
    default_image: str
    guaranteed_commands: tuple[str, ...]

    @classmethod
    def from_env(cls) -> ResolverExecutionEnvironment:
        from app.storage.sandbox_pod import DEFAULT_IMAGE

        configured_image = os.getenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", "").strip()
        default_image = configured_image or DEFAULT_IMAGE
        configured_commands = os.getenv(_DEFAULT_RUNNER_COMMANDS_ENV)
        if configured_commands is None:
            commands = _KNOWN_DEFAULT_RUNNER_COMMANDS if default_image == DEFAULT_IMAGE else ()
        else:
            commands = tuple(sorted({item.strip() for item in configured_commands.split(",") if item.strip()}))
        return cls(default_image=default_image, guaranteed_commands=commands)

    def prompt_payload(self) -> dict[str, object]:
        return {
            "default_image": self.default_image,
            "guaranteed_commands": list(self.guaranteed_commands),
            "image_selection": (
                "When an action requires commands outside guaranteed_commands, either add preparation steps executable "
                "by the default image or set execution_requirement.image to a suitable OCI image."
            ),
        }


class SkillResolver:
    def __init__(self, execution_environment: ResolverExecutionEnvironment | None = None) -> None:
        self._execution_environment = execution_environment or ResolverExecutionEnvironment.from_env()

    def _environment(self) -> ResolverExecutionEnvironment:
        environment = getattr(self, "_execution_environment", None)
        if environment is None:
            environment = ResolverExecutionEnvironment.from_env()
            self._execution_environment = environment
        return environment

    async def resolve(
        self,
        original_root: Path,
        *,
        previous_original_root: Path | None = None,
        previous_actions_file: Path | None = None,
    ) -> ResolvedSkillOutput:
        try:
            base_prompt = self._build_prompt(
                original_root,
                previous_original_root=previous_original_root,
                previous_actions_file=previous_actions_file,
            )
        except Exception as exc:
            _LOGGER.warning(
                "skill_resolver_prompt_extraction_failed original_root=%s error_type=%s error=%s",
                original_root,
                type(exc).__name__,
                exc,
                exc_info=True,
            )
            raise
        prompt = base_prompt
        last_error: Exception | None = None
        for attempt in range(1, _MAX_RESOLVER_ATTEMPTS + 1):
            try:
                text = await self._generate(prompt)
            except Exception as exc:
                _LOGGER.warning(
                    "skill_resolver_generation_failed original_root=%s attempt=%s/%s error_type=%s error=%s",
                    original_root,
                    attempt,
                    _MAX_RESOLVER_ATTEMPTS,
                    type(exc).__name__,
                    exc,
                    exc_info=True,
                )
                raise
            payload: object | None = None
            output: ResolvedSkillOutput | None = None
            try:
                payload = json.loads(text)
                output = ResolvedSkillOutput.model_validate(payload)
                validate_generated_sandbox_placeholders(output)
                validate_action_execution_environment(output, self._environment())
                ensure_default_skill_docs(output, original_root)
                return output
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                last_error = exc
                _LOGGER.warning(
                    "skill_resolver_generated_actions_rejected original_root=%s attempt=%s/%s "
                    "stage=%s action_count=%s error_type=%s error=%s",
                    original_root,
                    attempt,
                    _MAX_RESOLVER_ATTEMPTS,
                    _resolver_rejection_stage(exc, output),
                    _generated_action_count(payload, output),
                    type(exc).__name__,
                    exc,
                )
                if attempt >= _MAX_RESOLVER_ATTEMPTS:
                    break
                prompt = self._build_retry_prompt(base_prompt, attempt, exc)
        raise ValueError(f"resolver output failed validation after {_MAX_RESOLVER_ATTEMPTS} attempts: {last_error}")

    async def _generate(self, prompt: str) -> str:
        import app.llmhubs
        from app.llmhubs.request_builder import build_llm_request

        response = await app.llmhubs.generate(
            request=build_llm_request(
                [
                    {"role": "system", "content": _RESOLVER_SYSTEM_PROMPT},
                    {"role": "user", "content": [{"type": "text", "text": prompt}]},
                ],
                response_format=ResolvedSkillOutput,
            )
        )
        if response.code != 0:
            raise RuntimeError(response.msg or "skill resolver LLM request failed")
        for output in response.outputs:
            if output.json is not None:
                return json.dumps(output.json, ensure_ascii=False)
        text = response.outputs[0].text if response.outputs else response.text
        if not text:
            raise RuntimeError("skill resolver returned empty output")
        return text

    def _build_prompt(
        self,
        original_root: Path,
        *,
        previous_original_root: Path | None = None,
        previous_actions_file: Path | None = None,
    ) -> str:
        files = list_original_files(original_root)
        markdown_files = []
        script_files = []
        for rel_path, size in files:
            path = original_root / rel_path
            if rel_path.lower().endswith(".md"):
                markdown_files.append((rel_path, path, size))
            elif _is_script_for_prompt(rel_path):
                script_files.append((rel_path, path, size))
        payload = {
            "execution_environment": self._environment().prompt_payload(),
            "file_tree": [{"path": rel_path, "size_bytes": size} for rel_path, size in files],
            "markdown_files": _read_markdown_files_for_prompt(markdown_files),
            "important_files": _read_script_files_for_prompt(script_files),
        }
        update_context = build_update_context(
            previous_original_root,
            original_root,
            previous_actions_file=previous_actions_file,
        )
        if update_context:
            payload["update_context"] = update_context
        return json.dumps(payload, ensure_ascii=False, indent=2)

    @staticmethod
    def _build_retry_prompt(base_prompt: str, attempt: int, exc: Exception) -> str:
        return (
            f"{base_prompt}\n\n"
            f"The previous resolver output attempt {attempt} failed JSON/schema validation:\n{exc}\n\n"
            "Return corrected JSON matching the requested schema. Do not repeat the validation error.\n"
            "If an action parameter represents a user-provided workspace file, reference it as "
            '"{workspace_dir}/{parameter_name}" in argv or optional_argv, not as "{workspace_dir}/parameter_name". '
            "Every declared parameter must appear inside braces somewhere in argv or optional_argv."
        )


def _resolver_rejection_stage(exc: Exception, output: ResolvedSkillOutput | None) -> str:
    if isinstance(exc, json.JSONDecodeError):
        return "json_decode"
    if isinstance(exc, ValidationError):
        return "schema_validation"
    if output is None:
        return "output_validation"
    message = str(exc)
    if "sandbox placeholder" in message or "sandbox parameter" in message:
        return "sandbox_validation"
    if "requires commands not guaranteed" in message:
        return "execution_environment_validation"
    return "generated_action_validation"


def _generated_action_count(payload: object | None, output: ResolvedSkillOutput | None) -> int | str:
    if output is not None:
        return len(output.actions)
    if isinstance(payload, dict) and isinstance(payload.get("actions"), list):
        return len(payload["actions"])
    return "unknown"


def build_fallback_resolved_skill(original_root: Path) -> ResolvedSkillOutput:
    cortex = [ResolvedCortexFile(name=rel_path) for rel_path, _ in list_original_files(original_root)]
    return ResolvedSkillOutput(cortex=cortex, actions=[])


def validate_action_execution_environment(
    output: ResolvedSkillOutput,
    environment: ResolverExecutionEnvironment,
) -> None:
    guaranteed = set(environment.guaranteed_commands)
    for action in output.actions:
        if action.execution_requirement.backend in {"local", "linux_workstation"}:
            continue
        if action.execution_requirement.image.strip():
            continue
        preparation_commands = {_command_name(step.argv[0]) for step in action.preparation.steps}
        unavailable_preparation = sorted(preparation_commands - guaranteed)
        if unavailable_preparation:
            raise ValueError(
                f"action {action.name!r} preparation requires commands not guaranteed by default image "
                f"{environment.default_image!r}: {unavailable_preparation}; set execution_requirement.image"
            )
        if action.preparation.steps:
            continue
        action_commands = {_command_name(step.argv[0]) for step in action.steps}
        unavailable = sorted(action_commands - guaranteed)
        if unavailable:
            raise ValueError(
                f"action {action.name!r} requires commands not guaranteed by default image "
                f"{environment.default_image!r}: {unavailable}; set execution_requirement.image or add preparation steps"
            )


def _command_name(value: str) -> str:
    return Path(value).name


def build_update_context(
    previous_original_root: Path | None,
    original_root: Path,
    *,
    previous_actions_file: Path | None = None,
) -> dict[str, object]:
    if previous_original_root is None or not previous_original_root.exists():
        return {}
    context: dict[str, object] = {"changed_files": _diff_original_files(previous_original_root, original_root)}
    previous_actions = _previous_actions_manifest(previous_actions_file)
    if previous_actions is not None:
        context["previous_actions_manifest"] = previous_actions
    return context


def _diff_original_files(previous_root: Path, current_root: Path) -> list[dict[str, object]]:
    previous_files = {rel_path: previous_root / rel_path for rel_path, _ in list_original_files(previous_root)}
    current_files = {rel_path: current_root / rel_path for rel_path, _ in list_original_files(current_root)}
    changes: list[dict[str, object]] = []
    remaining_budget = _MAX_TOTAL_DIFF_BYTES
    for rel_path in sorted(set(previous_files) | set(current_files)):
        previous_path = previous_files.get(rel_path)
        current_path = current_files.get(rel_path)
        if previous_path and current_path and previous_path.read_bytes() == current_path.read_bytes():
            continue
        change: dict[str, object] = {"path": rel_path}
        if previous_path is None and current_path is not None:
            change["change_type"] = "added"
            change["current_size_bytes"] = current_path.stat().st_size
            remaining_budget = _attach_content_preview(change, "current_content", current_path, remaining_budget)
        elif current_path is None and previous_path is not None:
            change["change_type"] = "deleted"
            change["previous_size_bytes"] = previous_path.stat().st_size
            remaining_budget = _attach_content_preview(change, "previous_content", previous_path, remaining_budget)
        elif previous_path is not None and current_path is not None:
            change["change_type"] = "modified"
            change["previous_size_bytes"] = previous_path.stat().st_size
            change["current_size_bytes"] = current_path.stat().st_size
            remaining_budget = _attach_unified_diff(change, previous_path, current_path, remaining_budget)
        changes.append(change)
    return changes


def _attach_unified_diff(change: dict[str, object], previous_path: Path, current_path: Path, budget: int) -> int:
    if budget <= 0:
        change["diff_omitted"] = "total diff budget exceeded"
        return budget
    previous_text = _read_diff_text(previous_path)
    current_text = _read_diff_text(current_path)
    if previous_text is None or current_text is None:
        change["diff_omitted"] = "binary or too large"
        return budget
    diff = "".join(
        difflib.unified_diff(
            previous_text.splitlines(keepends=True),
            current_text.splitlines(keepends=True),
            fromfile=f"previous/{change['path']}",
            tofile=f"current/{change['path']}",
        )
    )
    if not diff:
        return budget
    encoded = diff.encode("utf-8")
    if len(encoded) > budget:
        diff = encoded[:budget].decode("utf-8", errors="replace") + "\n...TRUNCATED..."
        change["diff_truncated"] = True
        budget = 0
    else:
        budget -= len(encoded)
    change["diff"] = diff
    return budget


def _attach_content_preview(change: dict[str, object], key: str, path: Path, budget: int) -> int:
    if budget <= 0:
        change[f"{key}_omitted"] = "total diff budget exceeded"
        return budget
    text = _read_diff_text(path)
    if text is None:
        change[f"{key}_omitted"] = "binary or too large"
        return budget
    encoded = text.encode("utf-8")
    if len(encoded) > budget:
        text = encoded[:budget].decode("utf-8", errors="replace") + "\n...TRUNCATED..."
        change[f"{key}_truncated"] = True
        budget = 0
    else:
        budget -= len(encoded)
    change[key] = text
    return budget


def _read_diff_text(path: Path) -> str | None:
    if path.stat().st_size > _MAX_DIFF_FILE_BYTES:
        return None
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None


def _previous_actions_manifest(path: Path | None) -> object | None:
    if path is None or not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def build_actions_manifest(
    actions: list[ResolvedAction],
    *,
    review_status: Literal["proposed", "accepted"] = "accepted",
    source_provenance: Literal["author", "resolver", "legacy"] = "author",
) -> ResolvedActionsManifest:
    return ResolvedActionsManifest(
        schema_version=ACTION_MANIFEST_SCHEMA_VERSION,
        review_status=review_status,
        source_provenance=source_provenance,
        actions=actions,
    )


def ensure_default_skill_docs(output: ResolvedSkillOutput, original_root: Path) -> None:
    cortex_names = {file.name for file in output.cortex}
    for rel_path, _ in list_original_files(original_root):
        if Path(rel_path).name == "SKILL.md" and rel_path not in cortex_names:
            output.cortex.append(ResolvedCortexFile(name=rel_path))
            cortex_names.add(rel_path)


def validate_resolved_skill(
    output: ResolvedSkillOutput,
    original_root: Path,
    execution_environment: ResolverExecutionEnvironment | None = None,
) -> None:
    original_files = {rel_path for rel_path, _ in list_original_files(original_root)}
    for cortex_file in output.cortex:
        validate_relative_path(cortex_file.name)
        if cortex_file.name not in original_files:
            raise ValueError(f"cortex file not found in original skill: {cortex_file.name}")
    cortex_names = {file.name for file in output.cortex}
    if "SKILL.md" not in cortex_names:
        raise ValueError("resolved cortex must include SKILL.md")
    skill_md_content = (original_root / "SKILL.md").read_text(encoding="utf-8")
    metadata = parse_skill_frontmatter(skill_md_content)
    if not metadata.get("name") or not metadata.get("description"):
        raise ValueError("resolved SKILL.md must contain non-empty name and description")
    validate_action_execution_environment(
        output,
        execution_environment or ResolverExecutionEnvironment.from_env(),
    )
    for action in output.actions:
        for step in (*action.preparation.steps, *action.steps):
            if step.cwd:
                validate_relative_path(step.cwd, allow_dot=True)


def list_original_files(original_root: Path) -> list[tuple[str, int]]:
    if not original_root.exists():
        return []
    files: list[tuple[str, int]] = []
    for path in sorted(original_root.rglob("*")):
        if not path.is_file():
            continue
        rel_path = path.relative_to(original_root).as_posix()
        files.append((rel_path, path.stat().st_size))
    return files


def load_resolved_actions(skill_root: Path) -> list[ResolvedAction]:
    actions_file = skill_root / RESOLVED_ACTIONS_FILE
    if not actions_file.exists():
        return []
    manifest = load_actions_manifest(actions_file)
    if manifest.review_status != "accepted":
        return []
    return list(manifest.actions)


def load_actions_manifest(
    actions_file: Path,
    *,
    legacy_provenance: Literal["author", "legacy"] = "legacy",
) -> ResolvedActionsManifest:
    data = json.loads(actions_file.read_text(encoding="utf-8"))
    data = _without_legacy_step_env(data)
    data = _without_legacy_target_capabilities(data)
    if isinstance(data, list):
        return build_actions_manifest(
            [ResolvedAction.model_validate(item) for item in data],
            source_provenance=legacy_provenance,
        )
    if isinstance(data, dict) and data.get("schema_version") in (1, 2):
        return build_actions_manifest(
            [ResolvedAction.model_validate(item) for item in data.get("actions", [])],
            source_provenance=legacy_provenance,
        )
    manifest = ResolvedActionsManifest.model_validate(data)
    if manifest.schema_version != ACTION_MANIFEST_SCHEMA_VERSION:
        raise ValueError(f"unsupported actions manifest schema_version: {manifest.schema_version}")
    return manifest


def _without_legacy_target_capabilities(data: object) -> object:
    if isinstance(data, list):
        actions = data
    elif isinstance(data, dict) and isinstance(data.get("actions"), list):
        actions = data["actions"]
    else:
        return data
    for action in actions:
        if not isinstance(action, dict):
            continue
        target = action.get("target_requirements")
        if not isinstance(target, dict) or "capabilities" not in target:
            continue
        capabilities = [str(item).strip() for item in target.pop("capabilities", []) if str(item).strip()]
        if capabilities != ["android.adb"]:
            raise ValueError(f"unsupported legacy target capabilities: {capabilities}")
    return data


def _read_script_files_for_prompt(script_files: list[tuple[str, Path, int]]) -> list[dict[str, object]]:
    remaining = _MAX_SCRIPT_BYTES
    result: list[dict[str, object]] = []
    small_scripts = [item for item in script_files if item[2] <= _MAX_FULL_SCRIPT_BYTES]
    large_scripts = [item for item in script_files if item[2] > _MAX_FULL_SCRIPT_BYTES]
    for rel_path, path, size in [*small_scripts, *large_scripts]:
        if remaining <= 0:
            result.append({"path": rel_path, "size_bytes": size, "content_omitted": "script content budget exceeded"})
            continue
        content, used_bytes, truncated = _read_budgeted_text(path, remaining)
        remaining -= used_bytes
        item: dict[str, object] = {"path": rel_path, "size_bytes": size, "content": content}
        if size <= _MAX_FULL_SCRIPT_BYTES:
            item["included_full_content"] = True
        if truncated:
            item["content_truncated"] = True
        result.append(item)
    return result


def _read_markdown_files_for_prompt(markdown_files: list[tuple[str, Path, int]]) -> list[dict[str, object]]:
    remaining = _MAX_TOTAL_MARKDOWN_BYTES
    result: list[dict[str, object]] = []
    skill_docs = [item for item in markdown_files if Path(item[0]).name == "SKILL.md"]
    skill_docs.sort(key=lambda item: (item[0] != "SKILL.md", item[0]))
    supporting_docs = [item for item in markdown_files if Path(item[0]).name != "SKILL.md"]
    supporting_docs.sort(key=lambda item: (item[2], item[0]))
    for rel_path, path, size in [*skill_docs, *supporting_docs]:
        if remaining <= 0:
            result.append({"path": rel_path, "size_bytes": size, "content_omitted": "markdown content budget exceeded"})
            continue
        file_budget = min(remaining, _MAX_MARKDOWN_BYTES)
        content, used_bytes, truncated = _read_budgeted_text(path, file_budget)
        remaining -= used_bytes
        item: dict[str, object] = {"path": rel_path, "size_bytes": size, "content": content}
        if truncated:
            item["content_truncated"] = True
        result.append(item)
    return result


def _read_budgeted_text(path: Path, budget: int) -> tuple[str, int, bool]:
    data = path.read_bytes()
    truncated = len(data) > budget
    if truncated:
        data = data[:budget]
    text = data.decode("utf-8", errors="ignore")
    used_bytes = len(text.encode("utf-8"))
    return text, used_bytes, truncated


def _without_legacy_step_env(data: object) -> object:
    if isinstance(data, list):
        for action in data:
            _drop_step_env(action)
    elif isinstance(data, dict):
        actions = data.get("actions")
        if isinstance(actions, list):
            for action in actions:
                _drop_step_env(action)
    return data


def _drop_step_env(action: object) -> None:
    if not isinstance(action, dict):
        return
    parameters = action.get("parameters")
    if isinstance(parameters, list):
        action["parameters"] = [
            parameter
            for parameter in parameters
            if not (isinstance(parameter, dict) and str(parameter.get("name", "")).lower() in _PLATFORM_MANAGED_PARAMETER_NAMES)
        ]
    steps = action.get("steps")
    if not isinstance(steps, list):
        return
    for step in steps:
        if isinstance(step, dict):
            step.pop("env", None)


def infer_required_parameter_names(action: ResolvedAction) -> set[str]:
    parameter_names = {parameter.name for parameter in action.parameters}
    required: set[str] = set()
    for step in action.steps:
        required.update(_placeholder_names(step.argv) & parameter_names)
    return required


def validate_generated_sandbox_placeholders(output: ResolvedSkillOutput) -> None:
    for action in output.actions:
        used_placeholders: set[str] = set()
        for step in action.steps:
            used_placeholders.update(_placeholder_names(step.argv))
            for group in step.optional_argv:
                used_placeholders.update(_placeholder_names(group))
        sandbox_placeholders = sorted(used_placeholders & _GENERATED_SANDBOX_PLACEHOLDERS)
        if sandbox_placeholders:
            raise ValueError(
                f"sandbox placeholders in generated action {action.name!r}: "
                f"{sandbox_placeholders}; use {_SANDBOX_PLACEHOLDER}"
            )
        sandbox_parameters = sorted(
            parameter.name for parameter in action.parameters if parameter.name in _GENERATED_SANDBOX_PLACEHOLDERS
        )
        if sandbox_parameters:
            raise ValueError(
                f"sandbox parameters in generated action {action.name!r}: "
                f"{sandbox_parameters}; use {_SANDBOX_PLACEHOLDER}"
            )


def infer_optional_parameter_names(action: ResolvedAction) -> set[str]:
    return {parameter.name for parameter in action.parameters} - infer_required_parameter_names(action)


def _placeholder_names(values: list[str]) -> set[str]:
    names: set[str] = set()
    for value in values:
        names.update(match.strip() for match in _PLACEHOLDER_RE.findall(str(value)) if match.strip())
    return names


def validate_relative_path(value: str, *, allow_dot: bool = False) -> None:
    normalized = value.replace("\\", "/").strip()
    if allow_dot and normalized in ("", "."):
        return
    if not normalized or normalized.startswith("/"):
        raise ValueError(f"path must be relative: {value}")
    if any(part in ("", ".", "..") for part in normalized.split("/")):
        raise ValueError(f"path must not contain traversal segments: {value}")


def _read_limited(path: Path, max_bytes: int) -> str:
    data = path.read_bytes()[:max_bytes]
    text = data.decode("utf-8", errors="replace")
    if path.stat().st_size > max_bytes:
        return f"{text}\n...TRUNCATED..."
    return text


def _is_script_for_prompt(rel_path: str) -> bool:
    name = Path(rel_path).name
    return (
        name in _IMPORTANT_SCRIPT_FILENAMES
        or Path(rel_path).suffix.lower() in _SCRIPT_FILE_SUFFIXES
        or any(rel_path.endswith(suffix) for suffix in _IMPORTANT_SCRIPT_SUFFIXES)
    )


_RESOLVER_SYSTEM_PROMPT = """
You resolve uploaded skills into a small agent-readable cortex and executable actions.
Return only JSON matching the requested schema.

Rules:
- Always include every original SKILL.md in cortex.
- Preserve referenced agent-facing files in cortex as well. Include referenced markdown files, schemas,
    examples, and non-runtime configuration examples unchanged in cortex.
- Do not include runtime scripts or dependency/build files in cortex, even if referenced by SKILL.md.
    Runtime source, lock files, dependency files, Makefiles, and generated assets belong to original/ and actions.
- A SKILL.md may resolve to multiple actions. Split workflows when the agent must inspect output or decide between
    phases; do not encode decision-dependent phases as consecutive steps in one action.
- If the skill does not include runnable scripts or does not document how to run them, leave actions as an empty list.
- Put deterministic, invocation-independent dependency setup in preparation.steps, usually ["uv", "sync"].
    Preparation steps must not use parameters, secrets, workspace/result paths, or sandbox placeholders. For
    portable prepared workers, use execution_requirement.backend "any"; deployments must provide Docker or
    Kubernetes. Then execute Python entrypoints in steps with ["uv", "run", ...] so dependencies installed into
    the prepared environment are used. Prefer
    ["uv", "run", "python", "-m", "package"] or ["uv", "run", "console-script", ...] over plain
    ["python", "-m", ...] / ["python", "script.py", ...]. For non-uv projects, use the documented local setup
    command such as ["python", "-m", "pip", "install", "-e", "."] in preparation.steps.
- Read execution_environment from the user payload. An empty execution_requirement.image means every preparation
    executable, and every action executable when there is no preparation, must appear in guaranteed_commands.
    Otherwise set execution_requirement.image to an OCI image that actually provides the required shell, language
    runtime, CLI tools, browsers, and system libraries. Do not assume Bash, Node.js, npx, Playwright, Chromium, ADB,
    or other tools exist merely because the uploaded skill references them.
- Preserve documented platform/tooling dependency setup commands from SKILL.md as preparation steps.
    If SKILL.md says to install ADB, browsers, CLIs, system packages, or other non-Python runtime tools with a
    command/script such as ["sh", "scripts/install-adb.sh"], include that setup step; do not assume ["uv", "sync"]
    installs platform dependencies.
- Built-in parameter placeholders are {workspace_dir}, {result_dir}, and {_sandbox}.
- Only for parameters that are actual workspace-relative file paths, pass them as {workspace_dir}/{parameter_name}.
    Never prefix scalar text parameters such as instructions, task_name, title, prompt, query, or description with
    {workspace_dir}; pass them directly as {instructions}, {task_name}, etc. Write final markdown or HTML
    deliverables under {result_dir}.
- Every parameter you define must be referenced in step.argv or step.optional_argv.
- Optional parameters must not appear in argv. Put optional CLI flag/value groups in step.optional_argv.
- Do not define environment variables in actions or platform parameters such as sico_endpoint,
    sico_agent_instance_id, or sico_app_name. These are injected automatically by the invoke_skill runtime.
- For Android actions, set infra_requirements to ["sandbox.android"] and use {_sandbox} directly anywhere
    the CLI expects the Android device id / ADB serial / host:port, for example ["--device-id", "{_sandbox}"].
    Do not define extra device endpoint parameters such as device_id, android_device_id, adb_endpoint, deviceIP, or
    sandbox_endpoint; the invoke_skill / task runtime injects {_sandbox} automatically.
- For Windows actions, set infra_requirements to ["sandbox.windows"] and use {_sandbox} in argv.
- For macOS actions, set infra_requirements to ["sandbox.macos"] and use {_sandbox} in argv.
- If one action can run on either Windows or macOS, set infra_requirements to ["sandbox.windows", "sandbox.macos"]
    and use {_sandbox} in argv. Do not generate separate actions for each platform.
- If an action needs a Linux Workstation as its controlled target, set target_requirements.type to
    "linux_workstation" and
    target_requirements.os to "linux". This is independent from execution_requirement.backend: a Kubernetes worker
    may control a Linux Workstation, while backend "linux_workstation" executes directly inside it. Do not emit target
    feature/capability lists and
    never require actions from another uploaded skill; cross-skill composition belongs to task planning.
- Default cwd is the skill runtime root. You can override it with a relative cwd in preparation or action steps.
""".strip()


__all__ = [
    "ACTION_MANIFEST_SCHEMA_VERSION",
    "ActionReadiness",
    "ActionsAdmissionDiagnostics",
    "ORIGINAL_DIR",
    "RESOLVED_ACTIONS_FILE",
    "RESOLVED_ACTIONS_PROPOSAL_FILE",
    "RESOLVED_ACTIONS_STATUS_FILE",
    "RESOLVED_CORTEX_DIR",
    "RESOLVED_DIR",
    "RESOLVED_STATUS_FILE",
    "ResolvedAction",
    "ResolvedActionLimits",
    "ResolvedActionOutput",
    "ResolvedActionStep",
    "ResolverExecutionEnvironment",
    "ResolvedActionsManifest",
    "ResolvedExecutionRequirement",
    "ResolvedSkillOutput",
    "SkillResolver",
    "SkillResolverDiagnostics",
    "build_actions_manifest",
    "build_fallback_resolved_skill",
    "ensure_default_skill_docs",
    "infer_optional_parameter_names",
    "infer_required_parameter_names",
    "list_original_files",
    "load_actions_manifest",
    "load_resolved_actions",
    "validate_generated_sandbox_placeholders",
    "validate_relative_path",
    "validate_resolved_skill",
]
