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

"""Per-turn Kubernetes pod lifecycle for sandboxed command execution.

This module is the single source of truth for "spin up an isolated container,
exec into it, clean up afterwards" infrastructure. The :class:`SandboxPod`
abstraction is consumed by the task-runtime ``K8sPodBackend`` (see
:mod:`app.biz.task_runtime.executors.command_backend`), which owns one pod per
``TaskRun`` and deletes it when the run's :class:`CommandSession` closes.

Pods are created per run (ensure -> exec -> delete) and live in a dedicated
namespace so blast radius is contained; the per-run session deletes its pod in
a ``finally`` path. Pods leaked by process crashes can be GC'd by an
out-of-band controller using the standard labels exposed below.

.. _skill-executor-followup:

SkillExecutor integration (follow-up)
-------------------------------------
The task-runtime ``SkillExecutor`` currently runs skill subprocesses inside
the core container via :func:`asyncio.create_subprocess_exec`. Routing those
subprocesses through this pod is the right end-state for production
deployments - but requires two changes that are out of scope for the initial
refactor:

1. The pod mounts only the chat workspace (``/app``). Skill scratch dirs
   live under ``{user_root}/turn/{turn_id}/results/{batch}/runs/{run_id}``
   which is *outside* the workspace mount. Adding a second mount for the
   turn root (e.g. ``/sico/turn``) is the minimum change.
2. ``SkillLoader`` renders ``argv`` with absolute host paths today, which
   would resolve incorrectly inside the pod. Skills must either receive
   pod-translated paths (resolver-side change) or rely solely on relative
   paths via ``SICO_TASK_WORKSPACE``.

Longer term we plan to replace ``kubectl exec`` with a thin gRPC agent
running in the pod so command execution becomes a proper RPC (with
back-pressure, streaming output, structured errors, and metrics) instead of
a stream-multiplexed protocol wedged into the K8s exec API. The
:class:`SandboxPod` abstraction here is intentionally narrow so it can be
swapped for a gRPC client without rippling through callers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from kubernetes import client as k8s_client
from kubernetes import config as k8s_config
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream as k8s_stream

_LOGGER = logging.getLogger(__name__)

# Module-level cache for the K8s API client. ``load_incluster_config`` /
# ``load_kube_config`` mutate global ``Configuration`` state, so re-loading on
# every call is wasteful; a single ``CoreV1Api`` instance also lets the
# underlying urllib3 PoolManager reuse connections across turns.
_CACHED_API: k8s_client.CoreV1Api | None = None
# Guards the lazy init of ``_CACHED_API`` so a startup burst of worker threads
# doesn't each build a client and race on the global ``Configuration`` that
# ``load_*_config`` mutates.
_CACHED_API_LOCK = threading.Lock()

# Per-thread exec clients. ``kubernetes.stream.stream`` swaps ``ApiClient.request``
# in place for the exec websocket, which is not thread-safe on a shared client;
# giving each worker thread its own client confines the swap to that thread while
# still reusing its connection pool across execs.
_EXEC_API_LOCAL = threading.local()

# Default sandbox identity. Production deployments override via env so an
# operator can swap the image (e.g. to ship adb / fastboot pre-installed)
# without code changes.
DEFAULT_NAMESPACE = "python-sandbox"
DEFAULT_IMAGE = "ghcr.io/astral-sh/uv:python3.14-alpine"
DEFAULT_WORKDIR = "/app"

# Standard labels applied to every sandbox pod. ``cleanup_for_user`` uses
# them as a selector; external GC controllers can rely on them too.
LABEL_APP = "app"
LABEL_APP_VALUE = "run-command"
LABEL_AGENT_INSTANCE = "sico-agent-instance-id"
LABEL_USER = "sico-user-id"

# Per-run task-runtime runner pods carry this ``app`` label value (see
# ``K8sPodBackend`` in app.biz.task_runtime.executors.command_backend); the
# default ``run-command`` value is used by the per-turn run_command pods. The
# reaper reclaims both so a pod leaked by either backend is swept the same way.
LABEL_APP_VALUE_TASK_RUNTIME = "task-runner"
_REAPABLE_APP_LABEL_VALUES = (LABEL_APP_VALUE, LABEL_APP_VALUE_TASK_RUNTIME)

# Bounded poll for the pod to become Running. Skill latency is dominated by
# the first ``ensure`` call so this is the cold-start budget operators see.
_POD_READY_TIMEOUT_SECONDS = 60

# --- Orphan pod reclamation -------------------------------------------------
# Sandbox pods run ``sleep infinity`` with ``restartPolicy=Never`` and no owner
# reference, so nothing reclaims a pod if the core process that created it dies
# (rolling deploy / OOM / eviction) before its ``finally`` delete runs. Three
# independent, defence-in-depth backstops keep them from leaking:
#   1. ``activeDeadlineSeconds`` on every pod — k8s self-terminates a pod whose
#      lifetime exceeds the bound even if core is gone. The default (2h) is far
#      above a single run's 600s default command timeout, so it never cuts a
#      healthy run short; it only reclaims a pod whose driver vanished.
#   2. A periodic reaper (:func:`run_sandbox_pod_reaper`) that deletes terminal
#      pods immediately and Running pods older than the ceiling. The ceiling
#      (default 3h) is kept *above* the deadline so a healthy pod is always
#      reclaimed by its own deadline first — the reaper's age rule therefore
#      only ever fires on deadline-less legacy pods (created before this code).
#   3. A best-effort delete of this process's own pods on graceful shutdown
#      (:func:`delete_tracked_sandbox_pods`), so a rolling deploy reclaims
#      in-flight pods at once instead of waiting for backstop (1)/(2).
_DEFAULT_POD_ACTIVE_DEADLINE_SECONDS = 7200
_DEFAULT_POD_REAP_INTERVAL_SECONDS = 300
_DEFAULT_POD_ORPHAN_CEILING_SECONDS = 10800

# Pods created by this process, tracked so a graceful shutdown can delete them
# promptly. Mutated only on the event loop thread (the async ``ensure`` /
# ``delete`` wrappers), never inside the offloaded K8s worker threads, so a
# plain set needs no extra locking.
_LIVE_PODS: set[tuple[str, str]] = set()


@dataclass(frozen=True)
class ExecResult:
    """Result of a command executed inside a sandbox pod."""

    return_code: int
    stdout: str
    stderr: str
    # ``system_error`` carries failures that happened *before* the user's
    # command ran (e.g. exec API errored, pod not found). Distinct from
    # ``stderr`` so callers can choose to surface them differently to the LLM.
    system_error: str = ""


@dataclass(frozen=True)
class VolumeMount:
    """A volume mounted into the sandbox pod, from one of two sources.

    - **hostPath** (``host_path`` set): the directory is created on demand
      (``type=DirectoryOrCreate``) so the first turn in a fresh deployment does
      not race on pod startup. This is the default and works whenever the
      storage is reachable as a node-local path (e.g. a hostPath-backed PV, as
      in the kind dev deployment).
    - **PVC** (``claim_name`` set): the pod references the same
      ``PersistentVolumeClaim`` core uses, optionally scoped to ``sub_path``
      within it. Required when storage is networked (NFS / cloud file shares)
      and therefore *not* visible through a node hostPath — see
      ``RUN_PYTHON_TOOL_SANDBOX_STORAGE_PVC``.

    Exactly one source is used: ``claim_name`` takes precedence when set.
    """

    name: str
    mount_path: str
    read_only: bool = False
    host_path: str = ""
    claim_name: str = ""
    sub_path: str = ""


def _volume_source(m: VolumeMount) -> dict[str, Any]:
    """Map a :class:`VolumeMount` to the kwargs for its ``V1Volume`` source.

    A ``claim_name`` selects the PVC source (shared networked storage); otherwise
    a node-local hostPath is used. Keeping this in one place means the two ways a
    sandbox can reach core's files never drift apart.

    The dataclass defaults allow constructing a mount with *neither* source set;
    that would yield a hostPath of ``""`` (silently the pod's CWD on the node), so
    we reject it here — a sandbox mount must name exactly one concrete source.
    """
    if m.claim_name:
        return {"persistent_volume_claim": k8s_client.V1PersistentVolumeClaimVolumeSource(claim_name=m.claim_name)}
    if not m.host_path:
        raise ValueError(f"VolumeMount {m.name!r} has neither host_path nor claim_name set")
    return {"host_path": k8s_client.V1HostPathVolumeSource(path=m.host_path, type="DirectoryOrCreate")}


@dataclass(frozen=True)
class PodResources:
    """CPU / memory requests + limits for the sandbox container.

    Defaults are intentionally conservative so a runaway skill cannot starve
    the node; operators tune per cluster via env (see :class:`SandboxPod`).
    """

    cpu_request: str = "100m"
    cpu_limit: str = "500m"
    memory_request: str = "64Mi"
    memory_limit: str = "256Mi"


@dataclass(frozen=True)
class SandboxPod:
    """Description of a single sandbox pod and the operations on it.

    Instances are cheap (no K8s I/O at construction); call :meth:`ensure`
    to create the pod and :meth:`exec` to run commands. Both methods are
    coroutine-friendly: they offload the blocking K8s client work to a
    thread.
    """

    namespace: str = DEFAULT_NAMESPACE
    image: str = DEFAULT_IMAGE
    workdir: str = DEFAULT_WORKDIR
    resources: PodResources = field(default_factory=PodResources)
    app_label_value: str = LABEL_APP_VALUE

    @classmethod
    def from_env(cls) -> SandboxPod:
        """Build a :class:`SandboxPod` honouring deployment env overrides.

        Recognised variables:

        - ``RUN_PYTHON_TOOL_SANDBOX_NAMESPACE``
        - ``TASK_RUNTIME_PYTHON_RUNNER_IMAGE``
        - ``RUN_PYTHON_TOOL_SANDBOX_CPU_REQUEST`` / ``..._CPU_LIMIT``
        - ``RUN_PYTHON_TOOL_SANDBOX_MEMORY_REQUEST`` / ``..._MEMORY_LIMIT``
        """
        return cls(
            namespace=_env("RUN_PYTHON_TOOL_SANDBOX_NAMESPACE", DEFAULT_NAMESPACE),
            image=_env("TASK_RUNTIME_PYTHON_RUNNER_IMAGE", DEFAULT_IMAGE),
            resources=PodResources(
                cpu_request=_env("RUN_PYTHON_TOOL_SANDBOX_CPU_REQUEST", PodResources.cpu_request),
                cpu_limit=_env("RUN_PYTHON_TOOL_SANDBOX_CPU_LIMIT", PodResources.cpu_limit),
                memory_request=_env("RUN_PYTHON_TOOL_SANDBOX_MEMORY_REQUEST", PodResources.memory_request),
                memory_limit=_env("RUN_PYTHON_TOOL_SANDBOX_MEMORY_LIMIT", PodResources.memory_limit),
            ),
        )

    # ---- lifecycle -------------------------------------------------------

    async def ensure(
        self,
        pod_name: str,
        *,
        user_id: str,
        agent_instance_id: int,
        mounts: list[VolumeMount],
        env: dict[str, str] | None = None,
    ) -> None:
        """Create the pod if missing; reuse if Running/Pending.

        Idempotent: safe to call from every command. Failed pods (Failed /
        Succeeded - both terminal) are deleted and recreated so a transient
        node-level failure does not poison the entire turn.
        """
        await asyncio.to_thread(
            self._ensure_sync,
            pod_name,
            user_id,
            agent_instance_id,
            mounts,
            env or {},
        )
        # Track for best-effort cleanup on graceful shutdown. Safe to add on
        # reuse too — the registry is a set keyed by (namespace, pod name).
        _LIVE_PODS.add((self.namespace, pod_name))

    async def exec(
        self,
        pod_name: str,
        argv: list[str],
        *,
        timeout: int = 0,
    ) -> ExecResult:
        """Run ``argv`` inside ``pod_name`` and return captured output.

        Returns an :class:`ExecResult` with ``return_code=-1`` and the
        failure reason in ``system_error`` for transport-level errors.
        """
        return await asyncio.to_thread(self._exec_sync, pod_name, argv, timeout)

    async def cleanup_for_user(self, agent_instance_id: int, user_label: str) -> None:
        """Delete every sandbox pod for ``(agent_instance_id, user_label)``.

        ``user_label`` is the *DNS-sanitised* user id (the same label value
        applied by :meth:`ensure`). Callers should pass the sanitised value
        - see :func:`pod_name_for_turn` which performs the same sanitisation.
        """
        await asyncio.to_thread(self._cleanup_sync, agent_instance_id, user_label)

    async def delete(self, pod_name: str) -> None:
        """Delete a single pod by name.

        Task-runtime runner containers are per run and should be destroyed as
        soon as their entrypoint exits; deleting by exact name avoids touching
        any per-turn run_command pod owned by the same user.
        """
        await asyncio.to_thread(self._delete_sync, pod_name)
        _LIVE_PODS.discard((self.namespace, pod_name))

    # ---- internals (sync; offloaded to a thread by the public coros) -----

    def _api(self) -> k8s_client.CoreV1Api:
        return _core_v1_api()

    def _ensure_sync(
        self,
        pod_name: str,
        user_id: str,
        agent_instance_id: int,
        mounts: list[VolumeMount],
        env: dict[str, str],
    ) -> None:
        api = self._api()
        try:
            existing = api.read_namespaced_pod(name=pod_name, namespace=self.namespace)
            if existing.status.phase in ("Running", "Pending"):
                _LOGGER.info(
                    "sandbox_pod_reuse name=%s phase=%s",
                    pod_name,
                    existing.status.phase,
                )
                return
            _LOGGER.info(
                "sandbox_pod_recreate name=%s phase=%s",
                pod_name,
                existing.status.phase,
            )
            api.delete_namespaced_pod(
                name=pod_name,
                namespace=self.namespace,
                body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
            )
        except ApiException as exc:
            if exc.status != 404:
                raise

        spec = self._build_pod_spec(pod_name, user_id, agent_instance_id, mounts, env)
        try:
            api.create_namespaced_pod(namespace=self.namespace, body=spec)
            _LOGGER.info(
                "sandbox_pod_created name=%s namespace=%s image=%s",
                pod_name,
                self.namespace,
                self.image,
            )
        except ApiException as exc:
            # Two ``ensure`` calls racing for the same (deterministic) pod
            # name is harmless: the second caller can simply reuse what the
            # first one created. Anything else is a real error.
            if exc.status != 409:
                raise
            _LOGGER.info("sandbox_pod_create_conflict name=%s; reusing existing", pod_name)

        for _ in range(_POD_READY_TIMEOUT_SECONDS):
            status = api.read_namespaced_pod_status(name=pod_name, namespace=self.namespace)
            if status.status.phase == "Running":
                return
            if status.status.phase in ("Failed", "Succeeded"):
                raise RuntimeError(f"Sandbox pod {pod_name} entered terminal phase {status.status.phase} during startup")
            time.sleep(1)
        raise RuntimeError(f"Sandbox pod {pod_name} did not reach Running within {_POD_READY_TIMEOUT_SECONDS}s")

    def _build_pod_spec(
        self,
        pod_name: str,
        user_id: str,
        agent_instance_id: int,
        mounts: list[VolumeMount],
        env: dict[str, str],
    ) -> k8s_client.V1Pod:
        # Several mounts can share one underlying source: the workspace and any
        # skill runtimes all live on the single chat PVC, each scoped by its own
        # sub_path. A pod must reference that PVC through exactly *one* V1Volume —
        # declaring the same claim in two volumes deadlocks the kubelet mount on
        # networked (NFS / CSI) backends, leaving the pod stuck in
        # ContainerCreating. Dedupe sources to one volume each, then point every
        # mount at its shared volume via sub_path.
        volume_names: dict[str, str] = {}
        volumes: list[k8s_client.V1Volume] = []
        volume_mounts: list[k8s_client.V1VolumeMount] = []
        for m in mounts:
            source_key = f"pvc:{m.claim_name}" if m.claim_name else f"host:{m.host_path}"
            vol_name = volume_names.get(source_key)
            if vol_name is None:
                vol_name = m.name
                volume_names[source_key] = vol_name
                volumes.append(k8s_client.V1Volume(name=vol_name, **_volume_source(m)))
            volume_mounts.append(
                k8s_client.V1VolumeMount(
                    name=vol_name,
                    mount_path=m.mount_path,
                    read_only=m.read_only,
                    sub_path=m.sub_path or None,
                )
            )
        env_vars = [k8s_client.V1EnvVar(name=name, value=value) for name, value in env.items()]
        # ``activeDeadlineSeconds`` is the platform-level backstop: k8s terminates
        # the pod once its lifetime exceeds the bound even if the core process that
        # owns it has died, so a leaked ``sleep infinity`` pod cannot live forever.
        # ``0`` disables it (the field is omitted).
        active_deadline = _pod_active_deadline_seconds()
        return k8s_client.V1Pod(
            metadata=k8s_client.V1ObjectMeta(
                name=pod_name,
                namespace=self.namespace,
                labels={
                    LABEL_APP: self.app_label_value,
                    LABEL_AGENT_INSTANCE: str(agent_instance_id),
                    LABEL_USER: user_id,
                },
            ),
            spec=k8s_client.V1PodSpec(
                restart_policy="Never",
                active_deadline_seconds=active_deadline or None,
                containers=[
                    k8s_client.V1Container(
                        name="sandbox",
                        image=self.image,
                        # ``IfNotPresent`` avoids a registry round-trip on
                        # every turn after the node has cached the image -
                        # critical for cold-start latency budgets.
                        image_pull_policy="IfNotPresent",
                        command=["sh", "-c", "sleep infinity"],
                        working_dir=self.workdir,
                        env=env_vars or None,
                        volume_mounts=volume_mounts or None,
                        resources=k8s_client.V1ResourceRequirements(
                            limits={
                                "cpu": self.resources.cpu_limit,
                                "memory": self.resources.memory_limit,
                            },
                            requests={
                                "cpu": self.resources.cpu_request,
                                "memory": self.resources.memory_request,
                            },
                        ),
                    ),
                ],
                volumes=volumes or None,
            ),
        )

    def _exec_sync(self, pod_name: str, argv: list[str], timeout: int) -> ExecResult:
        # Exec runs on a thread-local, unshared client because ``k8s_stream``
        # mutates the ApiClient's ``request`` in place for the duration of the
        # exec, which is not thread-safe on a shared client (see ``_exec_api``).
        # The per-thread client keeps that swap off the cached REST client used
        # by ensure/cleanup/the reaper, and reuses its connection pool across
        # execs.
        api = _exec_api()
        try:
            resp = k8s_stream(
                api.connect_get_namespaced_pod_exec,
                pod_name,
                self.namespace,
                command=argv,
                stderr=True,
                stdin=False,
                stdout=True,
                tty=False,
                _preload_content=False,
            )
        except ApiException as exc:
            return ExecResult(
                return_code=-1,
                stdout="",
                stderr="",
                system_error=f"Failed to exec in pod {pod_name}: {exc}",
            )

        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []
        deadline = time.monotonic() + timeout if timeout > 0 else None
        timed_out = False

        try:
            while resp.is_open():
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        timed_out = True
                        break
                    resp.update(timeout=min(1, remaining))
                else:
                    resp.update(timeout=1)
                if resp.peek_stdout():
                    stdout_chunks.append(resp.read_stdout())
                if resp.peek_stderr():
                    stderr_chunks.append(resp.read_stderr())

            if timed_out:
                resp.close()
                return ExecResult(
                    return_code=-1,
                    stdout="".join(stdout_chunks),
                    stderr=f"Command timed out after {timeout}s",
                )

            # Drain any output buffered after the channel closed.
            if resp.peek_stdout():
                stdout_chunks.append(resp.read_stdout())
            if resp.peek_stderr():
                stderr_chunks.append(resp.read_stderr())

            return_code = _parse_exec_exit_code(resp, stderr_chunks)
        except ApiException as exc:
            # The exec websocket handshake is performed lazily on first read
            # (``_preload_content=False``), so a missing or already-terminal pod
            # surfaces here rather than at ``k8s_stream`` setup. Mirror the setup
            # path and report it as a transport-level failure (the documented
            # ExecResult contract) instead of letting the ApiException escape as an
            # opaque INTERNAL crash: callers treat a populated ``system_error`` as a
            # retryable transient fault and re-run on a freshly provisioned pod.
            return ExecResult(
                return_code=-1,
                stdout="".join(stdout_chunks),
                stderr="".join(stderr_chunks),
                system_error=f"Failed to stream exec in pod {pod_name}: {exc}",
            )
        finally:
            try:
                resp.close()
            except Exception:  # noqa: BLE001 -- best-effort cleanup
                pass

        return ExecResult(
            return_code=return_code,
            stdout="".join(stdout_chunks),
            stderr="".join(stderr_chunks),
        )

    def _cleanup_sync(self, agent_instance_id: int, user_label: str) -> None:
        api = self._api()
        selector = _label_selector_for_user(agent_instance_id, user_label, self.app_label_value)
        try:
            pods = api.list_namespaced_pod(namespace=self.namespace, label_selector=selector)
        except ApiException:
            _LOGGER.exception(
                "sandbox_pod_cleanup_list_failed namespace=%s selector=%s",
                self.namespace,
                selector,
            )
            return
        for pod in pods.items:
            try:
                api.delete_namespaced_pod(
                    name=pod.metadata.name,
                    namespace=self.namespace,
                    body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
                )
                _LOGGER.info("sandbox_pod_deleted name=%s", pod.metadata.name)
            except ApiException as exc:
                if exc.status != 404:
                    _LOGGER.warning(
                        "sandbox_pod_delete_failed name=%s status=%s",
                        pod.metadata.name,
                        exc.status,
                    )

    def _delete_sync(self, pod_name: str) -> None:
        api = self._api()
        try:
            api.delete_namespaced_pod(
                name=pod_name,
                namespace=self.namespace,
                body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
            )
            _LOGGER.info("sandbox_pod_deleted name=%s", pod_name)
        except ApiException as exc:
            if exc.status != 404:
                raise


# ---- module-level helpers ----------------------------------------------------


def is_in_cluster() -> bool:
    """Return True iff the process appears to be running inside a K8s pod.

    Checked by the presence of the service-account token mount - the same
    signal used by ``load_incluster_config``. Avoids a noisy
    ``ConfigException`` on local dev.
    """
    return os.path.exists("/var/run/secrets/kubernetes.io/serviceaccount/token")


def label_selector_for_user(agent_instance_id: int, user_label: str) -> str:
    """Return the standard label selector for ``cleanup_for_user``.

    Exposed so external tooling (a GC cron, an admin dashboard) can match
    the same set of pods without re-implementing the selector format.
    """
    return _label_selector_for_user(agent_instance_id, user_label, LABEL_APP_VALUE)


def _label_selector_for_user(agent_instance_id: int, user_label: str, app_label_value: str) -> str:
    """Return a label selector for pods created by one SandboxPod app label."""
    return f"{LABEL_APP}={app_label_value},{LABEL_AGENT_INSTANCE}={agent_instance_id},{LABEL_USER}={user_label}"


def _parse_exec_exit_code(resp: Any, stderr_chunks: list[str]) -> int:
    """Parse the exit code from the K8s exec error channel.

    The error channel returns a JSON envelope whose ``causes`` array carries
    the exit code when the command exited non-zero. The status-line based
    fallback (``Success`` -> 0, anything else with stderr -> 1) matches the
    behaviour of ``kubectl exec`` so the LLM sees consistent return codes.
    """
    fallback = 0 if not stderr_chunks else 1
    try:
        err_status = resp.read_channel(3)
        if not err_status:
            return 0
        status = json.loads(err_status)
    except Exception:  # noqa: BLE001 -- defensive: malformed envelope
        return fallback
    if status.get("status") == "Success":
        return 0
    for cause in (status.get("details") or {}).get("causes", []) or []:
        if cause.get("reason") == "ExitCode":
            try:
                return int(cause.get("message", "1"))
            except (TypeError, ValueError):
                return 1
    return 1


def _env(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value or default


def _env_int(name: str, default: int, *, floor: int) -> int:
    """Return env ``name`` parsed as an int, clamped up to ``floor``.

    A blank or malformed value falls back to ``default`` (and logs once) so a
    typo in a deployment manifest can never silently disable a safety backstop.
    """
    raw = os.getenv(name, "").strip()
    if not raw:
        return max(default, floor)
    try:
        value = int(raw)
    except ValueError:
        _LOGGER.warning("invalid %s=%r; using default %d", name, raw, default)
        return max(default, floor)
    return max(value, floor)


def _pod_active_deadline_seconds() -> int:
    # ``0`` is a valid, explicit "no deadline" — a floor of 0 preserves it.
    return _env_int("TASK_RUNTIME_POD_ACTIVE_DEADLINE_SECONDS", _DEFAULT_POD_ACTIVE_DEADLINE_SECONDS, floor=0)


def _pod_reap_interval_seconds() -> int:
    return _env_int("TASK_RUNTIME_POD_REAP_INTERVAL_SECONDS", _DEFAULT_POD_REAP_INTERVAL_SECONDS, floor=10)


def _pod_orphan_ceiling_seconds() -> int:
    # ``0`` disables the age rule (terminal pods are still reaped).
    return _env_int("TASK_RUNTIME_POD_ORPHAN_CEILING_SECONDS", _DEFAULT_POD_ORPHAN_CEILING_SECONDS, floor=0)


def _core_v1_api() -> k8s_client.CoreV1Api:
    """Return the process-wide cached ``CoreV1Api``, loading config on first use.

    ``load_incluster_config`` / ``load_kube_config`` mutate global client state,
    so we load exactly once and reuse the connection pool across turns and the
    background reaper.
    """
    global _CACHED_API
    if _CACHED_API is None:
        with _CACHED_API_LOCK:
            if _CACHED_API is None:
                try:
                    k8s_config.load_incluster_config()
                except k8s_config.ConfigException:
                    k8s_config.load_kube_config()
                _CACHED_API = k8s_client.CoreV1Api()
    return _CACHED_API


def _exec_api() -> k8s_client.CoreV1Api:
    """Return a thread-local, **unshared** ``CoreV1Api`` for a single exec call.

    ``kubernetes.stream.stream`` swaps ``ApiClient.request`` with a websocket
    implementation for the duration of the exec and restores it in a ``finally``.
    That swap mutates the client in place and is **not thread-safe**: while one
    worker thread is inside ``stream()``, another thread issuing a REST call
    (pod read/list/delete) or another concurrent exec on the *same* client picks
    up the websocket ``request`` and fails the HTTP upgrade handshake
    (``ApiException(0)`` / ``Handshake status 200 OK``/``404``). Under a
    concurrent batch this corrupts the majority of runs.

    Each worker thread therefore gets its own client so the swap can never leak
    across threads, while REST callers keep reusing the cached client. The client
    is cached per thread (``_exec_sync`` runs on the bounded ``asyncio.to_thread``
    pool) so its connection pool is reused across execs instead of rebuilt per
    call.
    """
    api = getattr(_EXEC_API_LOCAL, "api", None)
    if api is None:
        _core_v1_api()  # ensure global client config is loaded exactly once
        api = k8s_client.CoreV1Api(k8s_client.ApiClient())
        _EXEC_API_LOCAL.api = api
    return api


def _reap_orphan_pods_sync(namespace: str, ceiling_seconds: int) -> int:
    """Delete leaked sandbox pods in ``namespace``; return the count deleted.

    Terminal pods (``Failed`` / ``Succeeded``) are always removed. A non-terminal
    pod is removed only when it is older than ``ceiling_seconds`` (``0`` disables
    the age rule). The selector matches every app-label value this module
    provisions so both run_command and task-runtime runner pods are covered.
    """
    api = _core_v1_api()
    selector = f"{LABEL_APP} in ({','.join(_REAPABLE_APP_LABEL_VALUES)})"
    try:
        pods = api.list_namespaced_pod(namespace=namespace, label_selector=selector)
    except ApiException:
        _LOGGER.warning("sandbox_pod_reap_list_failed namespace=%s", namespace, exc_info=True)
        return 0
    now = datetime.now(timezone.utc)
    reaped = 0
    for pod in pods.items:
        name = pod.metadata.name if pod.metadata else None
        if not name:
            continue
        phase = (pod.status.phase if pod.status else "") or ""
        if phase in ("Failed", "Succeeded"):
            reason = f"phase={phase}"
        else:
            created = pod.metadata.creation_timestamp if pod.metadata else None
            if created is None or ceiling_seconds <= 0:
                continue
            age = (now - created).total_seconds()
            if age < ceiling_seconds:
                continue
            reason = f"phase={phase or 'unknown'} age={int(age)}s>=ceiling={ceiling_seconds}s"
        try:
            api.delete_namespaced_pod(
                name=name,
                namespace=namespace,
                body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
            )
            reaped += 1
            _LOGGER.info("sandbox_pod_reaped name=%s namespace=%s %s", name, namespace, reason)
        except ApiException as exc:
            if exc.status != 404:
                _LOGGER.warning("sandbox_pod_reap_delete_failed name=%s status=%s", name, exc.status)
    return reaped


async def reap_orphan_sandbox_pods(
    namespace: str | None = None,
    *,
    ceiling_seconds: int | None = None,
) -> int:
    """Run one reaper sweep, offloading the blocking K8s calls to a thread."""
    ns = namespace or _env("RUN_PYTHON_TOOL_SANDBOX_NAMESPACE", DEFAULT_NAMESPACE)
    ceiling = ceiling_seconds if ceiling_seconds is not None else _pod_orphan_ceiling_seconds()
    return await asyncio.to_thread(_reap_orphan_pods_sync, ns, ceiling)


async def run_sandbox_pod_reaper(stop_event: asyncio.Event) -> None:
    """Periodically reclaim leaked sandbox pods until ``stop_event`` is set.

    A no-op outside the cluster (no service-account token) so running core
    locally never reaches out to a developer's kubeconfig context.
    """
    if not is_in_cluster():
        _LOGGER.info("sandbox_pod_reaper_disabled reason=not-in-cluster")
        return
    interval = _pod_reap_interval_seconds()
    while not stop_event.is_set():
        try:
            count = await reap_orphan_sandbox_pods()
            if count:
                _LOGGER.info("sandbox_pod_reaper_swept count=%d", count)
        except Exception:  # noqa: BLE001 -- a sweep failure must not kill the loop
            _LOGGER.warning("sandbox_pod_reaper_iteration_failed", exc_info=True)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except TimeoutError:
            continue


def _delete_pods_sync(pods: list[tuple[str, str]]) -> int:
    api = _core_v1_api()
    deleted = 0
    for namespace, name in pods:
        try:
            api.delete_namespaced_pod(
                name=name,
                namespace=namespace,
                body=k8s_client.V1DeleteOptions(grace_period_seconds=0),
            )
            deleted += 1
        except ApiException as exc:
            if exc.status != 404:
                _LOGGER.warning("sandbox_pod_shutdown_delete_failed name=%s status=%s", name, exc.status)
        except Exception:  # noqa: BLE001 -- best-effort shutdown cleanup
            _LOGGER.warning("sandbox_pod_shutdown_delete_failed name=%s", name, exc_info=True)
    return deleted


async def delete_tracked_sandbox_pods() -> int:
    """Best-effort delete every pod this process created (graceful shutdown).

    Snapshots and clears the registry on the event loop thread, then offloads the
    blocking deletes. Idempotent: a pod already gone yields a suppressed 404.
    """
    pods = list(_LIVE_PODS)
    _LIVE_PODS.clear()
    if not pods:
        return 0
    return await asyncio.to_thread(_delete_pods_sync, pods)
