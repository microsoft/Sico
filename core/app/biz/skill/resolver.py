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

from __future__ import annotations

import json
import logging
import re
import difflib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.storage.fs import parse_skill_frontmatter

_LOGGER = logging.getLogger(__name__)

ORIGINAL_DIR = "original"
RESOLVED_DIR = "resolved"
RESOLVED_CORTEX_DIR = "resolved/cortex"
RESOLVED_ACTIONS_FILE = "resolved/actions.json"
RESOLVED_STATUS_FILE = "status.json"
ACTION_MANIFEST_SCHEMA_VERSION = 1

_MAX_MARKDOWN_BYTES = 64 * 1024
_MAX_SCRIPT_BYTES = 48 * 1024
_MAX_FULL_SCRIPT_BYTES = 5 * 1024
_MAX_DIFF_FILE_BYTES = 48 * 1024
_MAX_TOTAL_DIFF_BYTES = 96 * 1024
_MAX_RESOLVER_ATTEMPTS = 3
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
_BUILT_IN_STEP_PLACEHOLDERS = {"workspace_dir", "result_dir"}
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


class ResolvedAction(BaseModel):
    model_config = STRICT_SCHEMA_CONFIG

    name: str
    description: str = Field(default="", description="User-facing action description. Do not use placeholders.")
    infra_requirements: list[str] = Field(default_factory=list)
    parameters: list[ResolvedActionParameter] = Field(default_factory=list)
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
    actions: list[ResolvedAction] = Field(default_factory=list)

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


class SkillResolver:
    async def resolve(
        self,
        original_root: Path,
        *,
        previous_original_root: Path | None = None,
        previous_actions_file: Path | None = None,
    ) -> ResolvedSkillOutput:
        base_prompt = self._build_prompt(
            original_root,
            previous_original_root=previous_original_root,
            previous_actions_file=previous_actions_file,
        )
        prompt = base_prompt
        last_error: Exception | None = None
        for attempt in range(1, _MAX_RESOLVER_ATTEMPTS + 1):
            text = await self._generate(prompt)
            try:
                payload = json.loads(text)
                output = ResolvedSkillOutput.model_validate(payload)
                ensure_default_skill_docs(output, original_root)
                return output
            except (json.JSONDecodeError, ValidationError) as exc:
                last_error = exc
                _LOGGER.warning(
                    "SkillResolver output failed validation attempt=%s/%s error=%s\nModel response:\n%s",
                    attempt,
                    _MAX_RESOLVER_ATTEMPTS,
                    exc,
                    text,
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
                markdown_files.append({"path": rel_path, "content": _read_limited(path, _MAX_MARKDOWN_BYTES)})
            elif _is_script_for_prompt(rel_path):
                script_files.append((rel_path, path, size))
        payload = {
            "file_tree": [{"path": rel_path, "size_bytes": size} for rel_path, size in files],
            "markdown_files": markdown_files,
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


def build_fallback_resolved_skill(original_root: Path) -> ResolvedSkillOutput:
    cortex = [ResolvedCortexFile(name=rel_path) for rel_path, _ in list_original_files(original_root)]
    return ResolvedSkillOutput(cortex=cortex, actions=[])


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


def build_actions_manifest(actions: list[ResolvedAction]) -> ResolvedActionsManifest:
    return ResolvedActionsManifest(schema_version=ACTION_MANIFEST_SCHEMA_VERSION, actions=actions)


def ensure_default_skill_docs(output: ResolvedSkillOutput, original_root: Path) -> None:
    cortex_names = {file.name for file in output.cortex}
    for rel_path, _ in list_original_files(original_root):
        if Path(rel_path).name == "SKILL.md" and rel_path not in cortex_names:
            output.cortex.append(ResolvedCortexFile(name=rel_path))
            cortex_names.add(rel_path)


def validate_resolved_skill(output: ResolvedSkillOutput, original_root: Path) -> None:
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
    for action in output.actions:
        for step in action.steps:
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
    data = json.loads(actions_file.read_text(encoding="utf-8"))
    data = _without_legacy_step_env(data)
    if isinstance(data, list):
        return [ResolvedAction.model_validate(item) for item in data]
    manifest = ResolvedActionsManifest.model_validate(data)
    if manifest.schema_version != ACTION_MANIFEST_SCHEMA_VERSION:
        raise ValueError(f"unsupported actions manifest schema_version: {manifest.schema_version}")
    return list(manifest.actions)


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
- For Python actions, add deterministic dependency setup first, usually ["uv", "sync"]. Then execute Python
    entrypoints with ["uv", "run", ...] so dependencies installed into the uv environment are used. Prefer
    ["uv", "run", "python", "-m", "package"] or ["uv", "run", "console-script", ...] over plain
    ["python", "-m", ...] / ["python", "script.py", ...]. For non-uv projects, use the documented local setup
    command such as ["python", "-m", "pip", "install", "-e", "."] and then the documented executable command.
- Preserve documented platform/tooling dependency setup commands from SKILL.md as action steps before execution.
    If SKILL.md says to install ADB, browsers, CLIs, system packages, or other non-Python runtime tools with a
    command/script such as ["sh", "scripts/install-adb.sh"], include that setup step; do not assume ["uv", "sync"]
    installs platform dependencies.
- Built-in path placeholders are {workspace_dir} and {result_dir} only.
- For files with fixed names, use literal paths such as {workspace_dir}/fixed.txt. For user-provided files, define
    a parameter and wrap that parameter in braces, such as {workspace_dir}/{input_file}.
- Every parameter you define must be referenced in step.argv or step.optional_argv with the parameter name wrapped
    in braces.
- Optional parameters must not appear in argv. Put optional CLI flag/value groups in step.optional_argv.
- Do not define reserved parameters in actions. These include sico_endpoint,
    sico_agent_instance_id, and sico_app_name. These are injected automatically by the invoke_skill runtime.
- For Android actions, set infra_requirements to ["sandbox.android"] and use {sandbox.android} directly anywhere
    the CLI expects the Android device id / ADB serial / host:port, for example ["--device-id", "{sandbox.android}"].
    Do not define extra device endpoint parameters such as device_id, android_device_id, adb_endpoint, deviceIP, or
    sandbox_endpoint; the invoke_skill / task runtime injects sandbox.android automatically.
- Default cwd is copied runtime folder. You can override it in actions.
""".strip()


__all__ = [
    "ACTION_MANIFEST_SCHEMA_VERSION",
    "ORIGINAL_DIR",
    "RESOLVED_ACTIONS_FILE",
    "RESOLVED_CORTEX_DIR",
    "RESOLVED_STATUS_FILE",
    "RESOLVED_DIR",
    "ResolvedAction",
    "ResolvedActionStep",
    "ResolvedActionsManifest",
    "ResolvedSkillOutput",
    "SkillResolver",
    "SkillResolverDiagnostics",
    "build_actions_manifest",
    "build_fallback_resolved_skill",
    "ensure_default_skill_docs",
    "infer_optional_parameter_names",
    "infer_required_parameter_names",
    "list_original_files",
    "load_resolved_actions",
    "validate_relative_path",
    "validate_resolved_skill",
]
