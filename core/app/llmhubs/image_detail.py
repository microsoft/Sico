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

"""Image ``detail`` parameter handling for multimodal requests.

The ``detail`` field on image inputs tells the upstream model how much
compute to spend on vision tokens. OpenAI defines four values — ``auto``,
``low``, ``high``, and ``original``. ``original`` was introduced with
``gpt-5.4``, but support is capability-specific rather than family-wide, so
Sico treats it as opt-in model config instead of guessing from the model name.

Sico intentionally does **not** fingerprint upstream models by name to guess
capabilities. Model-name heuristics are brittle (new models ship on short
cycles, OpenAI-compatible providers multiply the matrix combinatorially) and
the best source of truth is the model's own config entry. This module
therefore applies a very small, explicit resolution policy:

1. ``entry.config["supported_image_detail_levels"]`` wins when set. An empty
   list opts out of ``detail`` forwarding entirely.
2. Non-image model types always return an empty set.
3. Otherwise the conservative baseline (``auto``/``low``/``high``) is
    assumed. This matches the pre-``original`` OpenAI vision contract and
    avoids sending ``original`` to deployments that would 400 on it.

Models that support ``original`` must declare it in their config. See
``deploy/config/llmhubs/model-template.yaml`` for an example.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.types import ModelRegistryEntry

# All image-detail levels the Sico LLMHub recognizes — the full OpenAI
# Vision API enum. ``original`` is capability-gated and must only be listed
# for deployments that actually accept it.
VALID_IMAGE_DETAIL_LEVELS = frozenset({"auto", "low", "high", "original"})

# Assumed supported levels when a chat/multimodal model entry does not set
# ``supported_image_detail_levels``. This is the conservative, pre-5.4
# baseline; it deliberately omits ``original`` so unsupported deployments do
# not get a value they would reject.
_DEFAULT_IMAGE_DETAIL_LEVELS = frozenset({"auto", "low", "high"})

# ``ModelRegistryEntry.model_type`` enum values that accept image input.
# Centralized here so new image-capable types only need to be added in one
# place. Values match the ``ModelType`` proto enum (2 = multimodal).
_IMAGE_CAPABLE_MODEL_TYPES = frozenset({2})


def normalize_image_detail(value: Any) -> str | None:
    """Normalize a user-supplied detail value to a canonical lowercase string.

    Returns ``None`` for ``None`` or empty/whitespace-only input so callers
    can distinguish "detail not specified" from an invalid value that needs
    to be rejected.
    """
    if value is None:
        return None
    normalized = str(value).strip().lower()
    return normalized or None


def supported_image_detail_levels(entry: ModelRegistryEntry) -> frozenset[str]:
    """Return the image-detail levels accepted for ``entry``.

    Resolution order:

    1. Non-image model types (see :data:`_IMAGE_CAPABLE_MODEL_TYPES`) return
       an empty set regardless of config. This gate comes first so a
       misconfigured text/artifact model cannot opt into ``detail`` forwarding.
    2. ``entry.config["supported_image_detail_levels"]`` — when present,
       honored verbatim. An explicit empty list opts out entirely (any
       caller-supplied ``detail`` is silently dropped from outbound requests).
    3. Otherwise the OpenAI baseline (``auto``/``low``/``high``) is returned.
       Providers accepting more levels must opt in via config.
    """
    if entry.model_type not in _IMAGE_CAPABLE_MODEL_TYPES:
        return frozenset()
    configured = _configured_image_detail_levels(entry.config.get("supported_image_detail_levels"))
    if configured is not None:
        return configured
    return _DEFAULT_IMAGE_DETAIL_LEVELS


def resolve_image_detail(entry: ModelRegistryEntry, value: Any) -> str | None:
    """Validate a caller-supplied ``detail`` value against ``entry``.

    Returns the normalized level string when the value is accepted; returns
    ``None`` when the value is unset or when the model has opted out of
    detail forwarding (empty ``supported_image_detail_levels``).

    Raises:
        LLMHubRuntimeError: with ``code=400`` when the value is not a
            recognized detail level at all, or when it is valid but not
            enabled for this model.
    """
    normalized = normalize_image_detail(value)
    if normalized is None:
        return None
    if normalized not in VALID_IMAGE_DETAIL_LEVELS:
        raise LLMHubRuntimeError(
            f"invalid image detail value {normalized!r}; expected one of {', '.join(sorted(VALID_IMAGE_DETAIL_LEVELS))}",
            code=400,
            model=entry.model_key,
        )

    supported_levels = supported_image_detail_levels(entry)
    if not supported_levels:
        return None
    if normalized not in supported_levels:
        raise LLMHubRuntimeError(
            f"model '{entry.model_key}' does not support image detail {normalized!r}; "
            f"supported levels: {', '.join(sorted(supported_levels))}",
            code=400,
            model=entry.model_key,
        )
    return normalized


def _configured_image_detail_levels(value: Any) -> frozenset[str] | None:
    """Parse the optional ``supported_image_detail_levels`` config value.

    Accepts ``None`` (unset — falls back to defaults), a comma-separated
    string, or any non-mapping iterable of strings. Unknown levels are
    silently dropped so older configs stay forward-compatible when new
    levels are added.

    An explicit empty list / empty string is preserved as an empty frozenset
    to support the opt-out use case.
    """
    if value is None:
        return None

    if isinstance(value, str):
        raw_values: list[str] = [part.strip().lower() for part in value.split(",") if part.strip()]
    elif isinstance(value, Iterable) and not isinstance(value, bytes | bytearray | dict):
        raw_values = [str(part).strip().lower() for part in value]
    else:
        # Scalar non-string, non-iterable values (e.g. ``False``/``0``)
        # cannot represent a level list; treat as explicit opt-out rather
        # than silently falling through to the default.
        return frozenset()

    return frozenset(level for level in raw_values if level in VALID_IMAGE_DETAIL_LEVELS)
