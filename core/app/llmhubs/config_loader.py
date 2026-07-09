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

"""Loads LLMHub builtin model descriptors from YAML.

YAML fields mirror the proto ``ModelRegistryEntry`` (see proto/llmhubs/restful.proto):

  model_key               (str, required — or inferred from filename)
  display_name            (str, required)
  description             (str)
  model_type              (int|str: text=1, multimodal=2, artifact=3)
  provider_template_type  (int|str: azure_openai=1 .. gemini=7)
  default                 (bool — YAML-only, selects the default model)
  icon_uri                (str)
  io_profile              (dict — auto-derived from model_type if absent)
  config                  (dict, required — provider-specific settings)
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

_LOGGER = logging.getLogger(__name__)

# Matches ${VAR} or ${VAR:-default}. Backslash-escaped \${...} is left as literal.
_ENV_PATTERN = re.compile(r"(?<!\\)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


class _MissingEnvVarsError(ValueError):
    """Raised when a yaml references required env vars that are not set."""

    def __init__(self, missing: list[str]) -> None:
        super().__init__(
            f"missing required env vars: {', '.join(missing)}"
        )
        self.missing = missing


def _expand_env_in_string(value: str, missing: list[str]) -> str:
    def _sub(match: re.Match[str]) -> str:
        var_name = match.group(1)
        default_value = match.group(2)
        env_value = os.environ.get(var_name)
        if env_value is not None and env_value != "":
            return env_value
        if default_value is not None:
            # Explicit default (including empty string) means the author opted
            # in to the fallback, so we do not mark this as missing.
            return default_value
        missing.append(var_name)
        return ""

    expanded = _ENV_PATTERN.sub(_sub, value)
    return expanded.replace("\\${", "${")


def _expand_env_vars(value: Any, missing: list[str]) -> Any:
    if isinstance(value, str):
        return _expand_env_in_string(value, missing)
    if isinstance(value, dict):
        return {k: _expand_env_vars(v, missing) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env_vars(v, missing) for v in value]
    return value

_DEFAULT_MODEL_CONFIG_DIR = Path(__file__).resolve().parent.parent.parent / "config" / "llmhubs"

_PROVIDER_TEMPLATE_MAP: dict[str, int] = {
    "azure_openai": 1,
    "azure-openai": 1,
    "openai_compatible": 2,
    "openai-compatible": 2,
    "http_json": 4,
    "http-json": 4,
    "http_binary": 5,
    "http-binary": 5,
    "anthropic": 6,
    "gemini": 7,
}

_MODEL_TYPE_MAP: dict[str, int] = {
    "text": 1,
    "multimodal": 2,
    "artifact": 3,
}


@dataclass(frozen=True)
class BuiltinModelDefinition:
    """Mirrors proto ModelRegistryEntry — YAML-loadable subset."""

    model_key: str
    display_name: str
    model_type: int
    provider_template_type: int
    description: str
    icon_uri: str
    default: bool
    io_profile: dict[str, Any]
    config: dict[str, Any]


class ModelConfigLoader:
    """Loads LLMHub builtin model descriptors from YAML."""

    def __init__(self, config_dir: Path | str | None = None) -> None:
        self._config_dir = Path(config_dir) if config_dir else _DEFAULT_MODEL_CONFIG_DIR
        self.default_model_key: str | None = None
        if not self._config_dir.exists():
            raise FileNotFoundError(f"Missing model config directory: {self._config_dir}")

    def load(self) -> dict[str, BuiltinModelDefinition]:
        definitions: dict[str, BuiltinModelDefinition] = {}

        for yaml_file in sorted(self._config_dir.glob("*.y*ml")):
            try:
                data = self._read_yaml(yaml_file)
            except _MissingEnvVarsError as exc:
                _LOGGER.warning(
                    "llmhubs skipping model config %s because required env vars are unset: %s",
                    yaml_file.name,
                    ", ".join(exc.missing),
                )
                continue
            except Exception as exc:
                _LOGGER.warning("failed to load llmhubs model config", extra={"file": str(yaml_file)}, exc_info=exc)
                continue

            if data.get("template"):
                continue

            definition = self._build_definition(model_key=yaml_file.stem, payload=data)
            if definition is None:
                continue
            if definition.model_key in definitions:
                _LOGGER.warning(
                    "llmhubs duplicate model_key %s in %s; overriding previous definition",
                    definition.model_key,
                    yaml_file.name,
                )
            definitions[definition.model_key] = definition
            if definition.default:
                if self.default_model_key is None:
                    self.default_model_key = definition.model_key
                elif self.default_model_key != definition.model_key:
                    _LOGGER.warning(
                        "llmhubs multiple models marked default=true (kept %s, ignoring %s)",
                        self.default_model_key,
                        definition.model_key,
                    )

        if not definitions:
            raise RuntimeError(f"No usable model descriptors found under {self._config_dir}")

        return definitions

    @staticmethod
    def _read_yaml(path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            content = yaml.safe_load(handle) or {}
        if not isinstance(content, dict):
            raise ValueError(f"Model descriptor {path} must be a mapping")
        missing: list[str] = []
        expanded = _expand_env_vars(content, missing)
        if missing:
            # Deduplicate while preserving order.
            seen: set[str] = set()
            unique_missing = [v for v in missing if not (v in seen or seen.add(v))]
            raise _MissingEnvVarsError(unique_missing)
        return expanded

    def _build_definition(self, *, model_key: str, payload: dict[str, Any]) -> BuiltinModelDefinition | None:
        resolved_model_key = str(payload.get("model_key") or model_key).strip().lower()
        if not resolved_model_key:
            return None

        display_name = str(payload.get("display_name") or resolved_model_key).strip()
        description = str(payload.get("description") or "").strip()
        icon_uri = str(payload.get("icon_uri") or "").strip()
        is_default = bool(payload.get("default", False))

        model_type = _normalize_model_type(payload.get("model_type", "text"))
        provider_template_type = _normalize_provider_template_type(
            payload.get("provider_template_type")
        )

        if provider_template_type == 0:
            raise ValueError(f"unknown provider_template_type for model {resolved_model_key}")

        config = _normalize_mapping(payload.get("config"))
        io_profile = payload.get("io_profile") or _default_io_profile(model_type, provider_template_type)

        return BuiltinModelDefinition(
            model_key=resolved_model_key,
            display_name=display_name,
            model_type=model_type,
            provider_template_type=provider_template_type,
            description=description,
            icon_uri=icon_uri,
            default=is_default,
            io_profile=_normalize_mapping(io_profile),
            config=config,
        )


def _normalize_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _normalize_model_type(value: Any) -> int:
    if isinstance(value, int):
        return value if value in (1, 2, 3) else 1
    normalized = str(value).strip().lower()
    return _MODEL_TYPE_MAP.get(normalized, 1)


def _normalize_provider_template_type(value: Any) -> int:
    if isinstance(value, int):
        return value if value in (1, 2, 3, 4, 5, 6, 7) else 0
    normalized = str(value).strip().lower()
    return _PROVIDER_TEMPLATE_MAP.get(normalized, 0)


def _default_io_profile(model_type: int, provider_template_type: int) -> dict[str, Any]:
    # Gemini (7) supports function calling and structured output via the GeminiAdapter.
    supports_tools = provider_template_type in (1, 2, 7)
    supports_previous_response_id = provider_template_type in (1, 2)
    supports_structured_output = provider_template_type in (1, 2, 7)

    if model_type == 2:
        return {
            "input_types": ["text", "image", "file"],
            "output_types": ["text", "json"],
            "supports_tools": supports_tools,
            "supports_previous_response_id": supports_previous_response_id,
            "supports_structured_output": supports_structured_output,
        }
    if model_type == 3:
        return {
            "input_types": ["text", "image", "file"],
            "output_types": ["artifact"],
            "supports_tools": supports_tools,
            "supports_previous_response_id": supports_previous_response_id,
            "supports_structured_output": supports_structured_output,
        }
    return {
        "input_types": ["text"],
        "output_types": ["text"],
        "supports_tools": supports_tools,
        "supports_previous_response_id": supports_previous_response_id,
        "supports_structured_output": supports_structured_output,
    }
