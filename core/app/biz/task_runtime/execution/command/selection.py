"""Environment-driven command backend selection and resource-key mapping."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from .contracts import CommandBackend
from .docker import DockerBackend
from .kubernetes import K8sPodBackend
from .local import LocalBackend

if TYPE_CHECKING:
    from app.storage.sandbox_pod import SandboxPod

BACKEND_LOCAL = "local"
BACKEND_DOCKER = "docker"
BACKEND_K8S = "k8s"

RESOURCE_KEY_DOCKER = "docker"
RESOURCE_KEY_K8S_POD = "k8s_pod"


def select_backend(*, pod: SandboxPod | None = None) -> CommandBackend:
    choice = os.getenv("TASK_RUNTIME_BACKEND", "").strip().lower()
    if not choice:
        choice = _auto_detect_backend()
    if choice == BACKEND_LOCAL:
        return LocalBackend()
    if choice == BACKEND_DOCKER:
        return DockerBackend()
    if choice == BACKEND_K8S:
        return K8sPodBackend(pod)
    raise ValueError(f"unknown TASK_RUNTIME_BACKEND={choice!r}; expected one of local|docker|k8s")


def is_in_cluster() -> bool:
    from app.storage.sandbox_pod import is_in_cluster as _is_in_cluster

    return _is_in_cluster()


def _auto_detect_backend() -> str:
    try:
        if is_in_cluster():
            return BACKEND_K8S
    except Exception:
        pass
    return BACKEND_LOCAL


def active_backend_kind() -> str:
    choice = os.getenv("TASK_RUNTIME_BACKEND", "").strip().lower()
    return choice or _auto_detect_backend()


def backend_resource_key(kind: str | None = None) -> str | None:
    kind = kind if kind is not None else active_backend_kind()
    if kind == BACKEND_DOCKER:
        return RESOURCE_KEY_DOCKER
    if kind == BACKEND_K8S:
        return RESOURCE_KEY_K8S_POD
    return None
