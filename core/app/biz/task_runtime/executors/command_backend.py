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

"""Dispatch-agnostic command execution backends.

A :class:`CommandBackend` answers a single question: *where* does a command
run? It deliberately knows nothing about *what* is being run (a tool, a
resolved skill action, or a sub-agent) — that decision belongs to the
dispatch executors, which resolve their work into a :class:`CommandSpec` and
hand it to whichever backend the deployment selected.

This orthogonal split (dispatch × backend) lets every execution path share one
"run a command in a sandbox" primitive instead of each growing its own
container plumbing.

Three backends are provided:

- :class:`LocalBackend` — runs the command as a child process on the host. The
  workspace *is* the host directory, so there is no isolation; this is the
  zero-config default for a directly launched dev process.
- :class:`DockerBackend` — runs the command in a throwaway ``docker run --rm``
  container with bind-mounts. Works identically whether core is a host process
  or itself containerised (docker-compose / DooD); the only difference is host
  path translation, handled by :func:`to_host_path`.
- :class:`K8sPodBackend` — runs the command in a per-run sandbox pod
  (ensure → exec → delete), reusing :class:`~app.storage.sandbox_pod.SandboxPod`.

Backend selection follows 12-factor: an explicit ``TASK_RUNTIME_BACKEND`` env
var always wins; otherwise :func:`select_backend` auto-detects (in-cluster → k8s,
else → local). Docker is opt-in, never auto-detected, so a developer who merely
has Docker installed is never surprised by commands running in containers.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from ..workspace import workspace_layout

if TYPE_CHECKING:
    from app.storage.sandbox_pod import ExecResult, SandboxPod, VolumeMount

DEFAULT_BACKEND_TIMEOUT_SECONDS = 0  # 0 == no timeout

# A POSIX shell variable name: a letter/underscore followed by letters, digits
# or underscores. We only ever inject ``export K=V`` for keys matching this so a
# hostile key (e.g. one carrying shell metacharacters) can never break out of the
# assignment into command position. Values are always ``shlex.quote``-escaped.
_VALID_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class CommandMount:
    """A directory made visible inside the sandbox.

    ``host_path`` is the path on the machine that actually owns the bytes; for
    container backends it is translated through :func:`to_host_path` before it
    is handed to docker / kubernetes so docker-out-of-docker deployments mount
    the real node path rather than the in-container path.
    """

    name: str
    host_path: str
    mount_path: str
    read_only: bool = False


@dataclass(frozen=True)
class CommandSpec:
    """A fully-resolved command ready to execute in any sandbox.

    The dispatch executors are responsible for producing this: ``argv`` is the
    final command (skill executors read the resolver's pre-generated
    ``action.steps[].argv``; they never re-derive it).
    """

    argv: list[str]
    image: str = ""
    cwd: str = ""
    env: dict[str, str] = field(default_factory=dict)
    mounts: list[CommandMount] = field(default_factory=list)
    timeout_seconds: int = DEFAULT_BACKEND_TIMEOUT_SECONDS
    pod_name: str = ""
    metadata: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class CommandResult:
    """Captured outcome of a :class:`CommandSpec` run.

    ``system_error`` carries failures that happened *before* the command ran
    (backend could not start, timed out, transport error) so callers can
    surface them differently from the command's own ``stderr``.
    """

    return_code: int
    stdout: str = ""
    stderr: str = ""
    system_error: str = ""


def truncate_stream(text: str, limit: int) -> str:
    """Trim a captured stdout/stderr stream for inclusion in a result summary."""
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...[truncated]"


class CommandBackend(Protocol):
    async def run(self, spec: CommandSpec) -> CommandResult: ...

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        """Open a session bound to one ``TaskRun`` (one ``TaskSpec`` attempt).

        A session lets a multi-step dispatch (a skill action with N steps)
        run every step in the *same* sandbox instead of paying per-command
        startup. The lifecycle is ``open_session → run × N → aclose``:

        - For host/throwaway backends (local, docker) each :meth:`run` is
          independent, so the session is a thin pass-through.
        - For :class:`K8sPodBackend` the session owns exactly one pod for the
          run's lifetime: created on first :meth:`CommandSession.run`, reused
          across steps, and deleted on :meth:`CommandSession.aclose`. The next
          ``TaskSpec`` therefore always gets a fresh pod (no cross-task state),
          and the pod-count ceiling is enforced upstream by the scheduler's
          per-resource concurrency limit rather than by this layer.

        ``pod_name`` is the caller-sanitised, per-run pod identity (ignored by
        backends that do not name an instance). ``image`` is the default image
        when a :class:`CommandSpec` does not pin its own.
        """
        ...


class CommandSession(Protocol):
    """A per-run handle that executes one or more commands in one sandbox.

    Always paired with :meth:`CommandBackend.open_session`; callers must
    ``aclose`` it (typically in a ``finally``) so backends that hold a real
    resource (a pod) release it deterministically.
    """

    async def run(self, spec: CommandSpec) -> CommandResult: ...

    async def aclose(self) -> None: ...


class _StatelessSession:
    """Session for backends that need no per-run setup or teardown.

    Each :meth:`run` is fully independent (no shared container, no warm
    state), so this is a thin pass-through to the backend. It exists only so
    callers can treat every backend uniformly via the session lifecycle.
    """

    def __init__(self, backend: CommandBackend) -> None:
        self._backend = backend

    async def run(self, spec: CommandSpec) -> CommandResult:
        return await self._backend.run(spec)

    async def aclose(self) -> None:
        return None


# ---------------------------------------------------------------------------
# Host path translation (shared by container backends)
# ---------------------------------------------------------------------------


def to_host_path(path: str | Path) -> str:
    """Translate a core-visible path to the host/node-visible path.

    When core runs directly on the host the two are identical (no env set →
    identity). Under docker-compose / DooD or kubernetes the chat/skill roots
    live under a different prefix on the node; operators declare that prefix via
    ``TASK_RUNTIME_CONTAINER_HOSTPATH_BASE`` (chat workspace) and
    ``TASK_RUNTIME_SKILL_HOSTPATH_BASE`` (skills) and this maps accordingly.
    """
    resolved = Path(path).resolve()
    layout = workspace_layout()
    mapped = _mapped_host_path(resolved, root=layout.chat_root, base_env="TASK_RUNTIME_CONTAINER_HOSTPATH_BASE")
    if mapped != resolved:
        return str(mapped)
    return str(_mapped_host_path(resolved, root=layout.skill_root, base_env="TASK_RUNTIME_SKILL_HOSTPATH_BASE"))


def _mapped_host_path(path: Path, *, root: Path, base_env: str) -> Path:
    base = os.getenv(base_env, "").strip()
    if not base:
        return path
    try:
        relative = path.relative_to(root.resolve())
    except ValueError:
        return path
    return Path(base) / relative


def _sandbox_volume_mounts(mounts: list[CommandMount]) -> list["VolumeMount"]:
    """Translate the spec's :class:`CommandMount`s into pod :class:`VolumeMount`s.

    Two storage topologies are supported, chosen at deploy time:

    - **hostPath** (default): the mount is reachable as a node-local path, so we
      bind the (host-translated) directory directly. This is the kind/dev model.
    - **PVC** (``RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC`` set): storage is networked
      (e.g. NFS) and *not* visible through a node hostPath, so the sandbox pod
      must reference the same claim core uses. One claim suffices: everything the
      sandbox touches already lives under the chat root — workspace/result dirs
      are native to it and skill runtimes are copied into it at workspace-init —
      so skills/knowledge PVCs are never mounted here. Each mount becomes a
      ``sub_path`` into the claim, relative to the chat root (``storage_pvc_root``,
      ``/mnt/storage/chat`` with the stock layout); override the mount root only
      when the PVC sits elsewhere via ``RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT``.

    The claim name is a deploy-time fact known only to Helm, so it cannot be
    inferred from inside the pod — ``RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC`` both
    names the claim and toggles hostPath vs PVC. That one env var is the only
    required knob; everything else is derived.
    """
    from app.storage.sandbox_pod import VolumeMount

    claim = os.getenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC", "").strip()
    if not claim:
        return [
            VolumeMount(
                name=mount.name,
                mount_path=mount.mount_path,
                read_only=mount.read_only,
                host_path=to_host_path(mount.host_path),
            )
            for mount in mounts
        ]

    root_override = os.getenv("RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT", "").strip()
    if root_override:
        root = root_override.rstrip("/") or "/"
    else:
        from app.storage.fs import storage_pvc_root

        root = storage_pvc_root()
    volume_mounts: list[VolumeMount] = []
    for mount in mounts:
        sub_path = os.path.relpath(mount.mount_path, root)
        if sub_path == ".." or sub_path.startswith(".." + os.sep):
            raise ValueError(
                f"sandbox mount {mount.mount_path!r} is not under storage root {root!r}; "
                "set RUN_PYTHON_TOOL_SANDBOX_STORAGE_ROOT to the PVC mount root"
            )
        volume_mounts.append(
            VolumeMount(
                name=mount.name,
                mount_path=mount.mount_path,
                read_only=mount.read_only,
                claim_name=claim,
                sub_path=sub_path,
            )
        )
    return volume_mounts


# ---------------------------------------------------------------------------
# Shell script assembly (shared by container backends)
# ---------------------------------------------------------------------------


def _quote_argv(argv: list[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in argv)


def _build_shell_script(spec: CommandSpec, *, include_cd: bool, env_overrides: dict[str, str] | None = None) -> str:
    """Assemble optional ``cd`` + ``exec argv`` as one script.

    ``include_cd`` is True for backends whose native exec cannot set a working
    directory (a sandbox pod's ``exec``); it is False for backends that set the
    working directory directly (docker ``-w``, local subprocess ``cwd``).

    ``env_overrides`` injects per-step ``export K=V`` lines before the command.
    It is used by the reused-pod session to apply env that diverges from the
    pod's ensure-time env (the pod's base env is set once at creation). Keys are
    validated against :data:`_VALID_ENV_NAME_RE`; a key that is not a legal shell
    variable name is rejected rather than spliced into the script, so the export
    line can never become a command-injection vector.
    """
    lines: list[str] = []
    for key, value in (env_overrides or {}).items():
        if not _VALID_ENV_NAME_RE.match(key):
            raise ValueError(f"refusing to export invalid environment variable name: {key!r}")
        lines.append(f"export {key}={shlex.quote(value)}")
    if include_cd and spec.cwd:
        lines.append(f"cd {shlex.quote(spec.cwd)}")
    lines.append(f"exec {_quote_argv(spec.argv)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Local backend
# ---------------------------------------------------------------------------


class LocalBackend:
    """Run the command as a child process on the host.

    There is no isolation: the workspace directory passed as ``cwd`` is the
    real host directory, so files the command writes are immediately visible.
    Container-only fields (``image``, ``mounts``) are ignored beyond using the
    workspace mount as the working directory when ``cwd`` is unset.

    Read-only asymmetry (intentional): container backends mount the workspace
    read-only and only ``$SICO_RESULT_DIR`` writable, so a bare relative write
    from ``cwd`` (e.g. ``echo x > out.txt``) fails with *Read-only file system*.
    Here ``read_only`` mounts are not enforced, so that same write succeeds and
    lands in the real workspace. A command that ignores the "write under
    ``$SICO_RESULT_DIR``" contract therefore passes locally but fails in a
    container. This is inherent to the "no isolation" role, not a regression;
    to reproduce container fidelity, run with ``TASK_RUNTIME_BACKEND=docker``.
    """

    async def run(self, spec: CommandSpec) -> CommandResult:
        cwd = spec.cwd or _first_mount_host_path(spec) or os.getcwd()
        env = {**os.environ, **spec.env}
        proc = await asyncio.create_subprocess_exec(
            *spec.argv,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return await _collect_subprocess(proc, spec.timeout_seconds)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _StatelessSession(self)


def _first_mount_host_path(spec: CommandSpec) -> str:
    for mount in spec.mounts:
        if mount.host_path:
            return mount.host_path
    return ""


async def _collect_subprocess(proc: asyncio.subprocess.Process, timeout_seconds: int) -> CommandResult:
    try:
        if timeout_seconds and timeout_seconds > 0:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        else:
            stdout_b, stderr_b = await proc.communicate()
    except asyncio.TimeoutError:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()
        return CommandResult(return_code=-1, system_error=f"command timed out after {timeout_seconds}s")
    return CommandResult(
        return_code=proc.returncode if proc.returncode is not None else -1,
        stdout=stdout_b.decode(errors="replace"),
        stderr=stderr_b.decode(errors="replace"),
    )


# ---------------------------------------------------------------------------
# Docker backend
# ---------------------------------------------------------------------------


class DockerBackend:
    """Run the command in a throwaway ``docker run --rm`` container.

    Bind-mounts each :class:`CommandMount` (translated via :func:`to_host_path`)
    so the container reads/writes the host workspace directly — no tar sync. The
    same code path serves a host process and a containerised core; only the host
    path prefix differs, and :func:`to_host_path` already absorbs that.
    """

    def __init__(self, *, docker_path: str = "docker") -> None:
        self.docker_path = docker_path

    async def run(self, spec: CommandSpec) -> CommandResult:
        argv = self._build_docker_argv(spec)
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return await _collect_subprocess(proc, spec.timeout_seconds)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _StatelessSession(self)

    def _build_docker_argv(self, spec: CommandSpec) -> list[str]:
        argv: list[str] = [self.docker_path, "run", "--rm"]
        if spec.pod_name:
            argv += ["--name", spec.pod_name]
        if spec.cwd:
            argv += ["-w", spec.cwd]
        for mount in spec.mounts:
            host = to_host_path(mount.host_path)
            spec_str = f"{host}:{mount.mount_path}"
            if mount.read_only:
                spec_str += ":ro"
            argv += ["-v", spec_str]
        for key, value in spec.env.items():
            argv += ["-e", f"{key}={value}"]
        argv.append(spec.image or _default_runner_image())
        argv += list(spec.argv)
        return argv


def _default_runner_image() -> str:
    from app.storage.sandbox_pod import DEFAULT_IMAGE

    return os.getenv("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", DEFAULT_IMAGE).strip() or DEFAULT_IMAGE


# ---------------------------------------------------------------------------
# Kubernetes pod backend
# ---------------------------------------------------------------------------


class K8sPodBackend:
    """Run the command in a per-run sandbox pod (ensure → exec → delete).

    Wraps :class:`~app.storage.sandbox_pod.SandboxPod`. A fresh runner pod is
    created for each :class:`CommandSpec` and deleted in ``finally`` so a failed
    or long-running command never leaks pods.
    """

    def __init__(self, pod: SandboxPod | None = None) -> None:
        if pod is None:
            from app.storage.sandbox_pod import SandboxPod

            pod = SandboxPod.from_env()
        self.pod = pod

    async def run(self, spec: CommandSpec) -> CommandResult:
        pod = self._runner_pod(spec.image)
        pod_name = spec.pod_name or "task-runner"
        mounts = _sandbox_volume_mounts(spec.mounts)
        command = ["sh", "-lc", _build_shell_script(spec, include_cd=True)]
        try:
            await pod.ensure(
                pod_name,
                user_id=spec.metadata.get("user_label", "task-runner"),
                agent_instance_id=int(spec.metadata.get("agent_instance_id") or 0),
                mounts=mounts,
                env=spec.env,
            )
            result = await pod.exec(pod_name, command, timeout=spec.timeout_seconds)
            return _from_exec_result(result)
        finally:
            with contextlib.suppress(Exception):
                await pod.delete(pod_name)

    def open_session(self, *, pod_name: str = "", image: str = "") -> CommandSession:
        return _K8sPodSession(self, pod_name=pod_name or "task-runner", default_image=image)

    def _runner_pod(self, image: str) -> SandboxPod:
        from app.storage.sandbox_pod import SandboxPod

        return SandboxPod(
            namespace=self.pod.namespace,
            image=image or self.pod.image,
            workdir=self.pod.workdir,
            resources=self.pod.resources,
            app_label_value="task-runner",
        )


def _from_exec_result(result: ExecResult) -> CommandResult:
    return CommandResult(
        return_code=result.return_code,
        stdout=result.stdout,
        stderr=result.stderr,
        system_error=result.system_error,
    )


class _K8sPodSession:
    """One pod for the whole run: created on first :meth:`run`, reused across
    steps, deleted on :meth:`aclose`.

    The pod's mounts and env are taken from the first command (a run's steps
    share the same workspace mount and per-run env). ``cwd`` still varies per
    step and is applied inside the exec script. The next ``TaskSpec`` opens its
    own session and therefore its own fresh pod, satisfying the "clean / re-pull
    per TaskSpec" contract.

    Per-step ``env`` that diverges from the pod's ensure-time env is applied as
    ``export K=V`` lines prepended to the exec script (cf. the legacy
    invoke_skill pod path). Keys absent from a later step are left as set on the
    pod — like the legacy ``env K=V`` prefix, overrides add or change, never
    unset.
    """

    def __init__(self, backend: K8sPodBackend, *, pod_name: str, default_image: str = "") -> None:
        self._backend = backend
        self._pod_name = pod_name
        self._default_image = default_image
        self._pod: SandboxPod | None = None
        self._ensured_env: dict[str, str] = {}

    async def run(self, spec: CommandSpec) -> CommandResult:
        env_overrides: dict[str, str] = {}
        if self._pod is None:
            self._pod = self._backend._runner_pod(spec.image or self._default_image)
            mounts = _sandbox_volume_mounts(spec.mounts)
            await self._pod.ensure(
                self._pod_name,
                user_id=spec.metadata.get("user_label", "task-runner"),
                agent_instance_id=int(spec.metadata.get("agent_instance_id") or 0),
                mounts=mounts,
                env=spec.env,
            )
            self._ensured_env = dict(spec.env)
        else:
            env_overrides = {key: value for key, value in spec.env.items() if self._ensured_env.get(key) != value}
        command = ["sh", "-lc", _build_shell_script(spec, include_cd=True, env_overrides=env_overrides)]
        result = await self._pod.exec(self._pod_name, command, timeout=spec.timeout_seconds)
        return _from_exec_result(result)

    async def aclose(self) -> None:
        if self._pod is None:
            return
        pod, self._pod = self._pod, None
        with contextlib.suppress(Exception):
            await pod.delete(self._pod_name)


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------


# Backend kinds: the canonical values of ``TASK_RUNTIME_BACKEND`` and of
# :func:`active_backend_kind`. These name *where* a command runs.
BACKEND_LOCAL = "local"
BACKEND_DOCKER = "docker"
BACKEND_K8S = "k8s"

# Scheduler resource buckets: the keys :func:`backend_resource_key` returns and
# the scheduler caps via env-driven limits. ``local`` maps to no bucket (host
# subprocesses are bounded only by the global concurrency). Note ``k8s`` (a
# backend kind) maps to the ``k8s_pod`` bucket — the two vocabularies are
# distinct, so keep them as separate constants even though ``docker`` coincides.
RESOURCE_KEY_DOCKER = "docker"
RESOURCE_KEY_K8S_POD = "k8s_pod"


def select_backend(*, pod: SandboxPod | None = None) -> CommandBackend:
    """Pick the command execution backend for this deployment.

    Resolution order (12-factor):

    1. Explicit ``TASK_RUNTIME_BACKEND=local|docker|k8s`` always wins. Each
       deployment declares its capability: docker-compose sets ``docker``,
       kubernetes manifests set ``k8s``, a direct host process leaves it unset.
    2. Otherwise auto-detect a *safe* default: in-cluster → ``k8s``; else
       ``local``. Docker is opt-in only (never auto-selected) so a developer
       who merely has Docker installed is not surprised by containerised runs.
    """
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
    """Whether core runs inside a Kubernetes cluster.

    Kept as a module-level wrapper (rather than a top-level import) so the
    runtime avoids a static ``app.*`` dependency while ``_auto_detect_backend``
    still resolves it as a module global — which keeps the auto-detect path
    monkeypatchable in tests.
    """
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
    """Resolve the active backend choice (``local`` / ``docker`` / ``k8s``).

    Mirrors :func:`select_backend`'s resolution order without constructing a
    backend, so callers (e.g. the scheduler's resource-limit wiring) can reason
    about *where* runs will execute purely from configuration.
    """
    choice = os.getenv("TASK_RUNTIME_BACKEND", "").strip().lower()
    if not choice:
        choice = _auto_detect_backend()
    return choice


def backend_resource_key(kind: str | None = None) -> str | None:
    """Map the active backend to a scheduler resource key, or ``None``.

    ``local`` runs are plain host subprocesses bounded only by the global
    concurrency, so they have no per-resource key. ``docker`` and ``k8s`` each
    open a throwaway container/pod per run, so they map to ``"docker"`` /
    ``"k8s_pod"`` keys the scheduler caps via env-driven limits.
    """
    kind = kind if kind is not None else active_backend_kind()
    if kind == BACKEND_DOCKER:
        return RESOURCE_KEY_DOCKER
    if kind == BACKEND_K8S:
        return RESOURCE_KEY_K8S_POD
    return None
