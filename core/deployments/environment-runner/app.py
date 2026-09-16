from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import posixpath
import re
import socket
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Annotated, Any

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(title="Sico Prepared Environment Runner", version="1")

_DIGEST_RE = re.compile(r"^(?:.+@)?sha256:[0-9a-f]{64}$")
_KEY_RE = re.compile(r"^[0-9a-f]{64}$")
_MAX_CONTEXT_BYTES = int(os.getenv("PREPARED_ENV_MAX_CONTEXT_BYTES", str(64 * 1024 * 1024)))
_REPOSITORY = os.getenv("PREPARED_ENV_REPOSITORY", "sico-prepared-environment").strip()
_PULL_REPOSITORY = os.getenv("PREPARED_ENV_PULL_REPOSITORY", "").strip() or _REPOSITORY
_REGISTRY_DELETE_URL = os.getenv("PREPARED_ENV_REGISTRY_DELETE_URL", "").strip()
_PUSH = os.getenv("PREPARED_ENV_PUSH", "false").strip().lower() in {"1", "true", "yes"}
_COMMAND_VOLUME = os.getenv("PREPARED_ENV_COMMAND_VOLUME", "").strip()
_COMMAND_STORAGE_ROOT = os.getenv("PREPARED_ENV_COMMAND_STORAGE_ROOT", "/mnt/storage").rstrip("/") or "/"
_COMMAND_NETWORK = os.getenv("PREPARED_ENV_COMMAND_NETWORK", "").strip()
_DEFAULT_COMMAND_IMAGE = os.getenv("PREPARED_ENV_DEFAULT_COMMAND_IMAGE", "").strip()
_MAX_COMMAND_OUTPUT_BYTES = int(os.getenv("PREPARED_ENV_MAX_COMMAND_OUTPUT_BYTES", str(4 * 1024 * 1024)))
_BACKEND = os.getenv("PREPARED_ENV_BACKEND", "docker").strip().lower()
_BUILDKIT_ADDRESS = os.getenv("PREPARED_ENV_BUILDKIT_ADDRESS", "tcp://sico-buildkit:1234").strip()
_AZURE_REGISTRY_AUTH = os.getenv("PREPARED_ENV_AZURE_REGISTRY_AUTH", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
_REGISTRY_INSECURE = os.getenv("PREPARED_ENV_REGISTRY_INSECURE", "false").strip().lower() in {"1", "true", "yes"}
_AUTHENTICATED_REGISTRIES: set[str] = set()


class ImageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image: str


class DeleteEnvironmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image: str = ""


class CommandMountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mount_path: str
    read_only: bool = False


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    argv: list[str]
    image: str = ""
    cwd: str = ""
    env: dict[str, str] = Field(default_factory=dict)
    mounts: list[CommandMountRequest] = Field(default_factory=list)
    timeout_seconds: int = 0
    name: str = ""


CommandRequest.model_rebuild(_types_namespace={"CommandMountRequest": CommandMountRequest})


@app.get("/health")
def health() -> dict[str, str]:
    if _BACKEND == "registry" and not _buildkit_reachable():
        raise HTTPException(status_code=503, detail="buildkit is unavailable")
    return {"status": "ok"}


@app.post("/v1/images/resolve")
def resolve_image(request: ImageRequest) -> dict[str, str]:
    image = request.image.strip()
    if not image:
        raise HTTPException(status_code=400, detail="image is required")
    if _DIGEST_RE.fullmatch(image):
        return {"image": image}
    if _BACKEND == "registry":
        digest = _registry_image_digest(image)
        return {"image": _digest_reference(image, digest)}
    _require_backend("docker")
    _docker("pull", image, timeout=600)
    repo_digests = json.loads(_docker("image", "inspect", image, "--format", "{{json .RepoDigests}}"))
    if not repo_digests:
        raise HTTPException(status_code=409, detail="base image has no repository digest")
    digest = str(repo_digests[0])
    if not _DIGEST_RE.fullmatch(digest):
        raise HTTPException(status_code=502, detail="docker returned an invalid base image digest")
    return {"image": digest}


@app.post("/v1/environments/build")
async def build_environment(
    key: Annotated[str, Form()],
    spec: Annotated[str, Form()],
    context: Annotated[UploadFile, File()],
) -> dict[str, str | int]:
    if not _KEY_RE.fullmatch(key):
        raise HTTPException(status_code=400, detail="invalid environment key")
    try:
        payload = json.loads(spec)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid environment spec") from exc
    _validate_spec(payload)
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    if hashlib.sha256(canonical).hexdigest() != key:
        raise HTTPException(status_code=409, detail="environment key does not match spec")
    archive = await context.read(_MAX_CONTEXT_BYTES + 1)
    if len(archive) > _MAX_CONTEXT_BYTES:
        raise HTTPException(status_code=413, detail="build context is too large")
    with tempfile.TemporaryDirectory(prefix=f"sico-env-{key[:12]}-") as directory:
        build_root = Path(directory)
        runtime_root = build_root / "runtime"
        runtime_root.mkdir()
        _extract_runtime(archive, runtime_root)
        if _runtime_content_digest(runtime_root) != payload["runtime_digest"]:
            raise HTTPException(status_code=409, detail="runtime digest does not match build context")
        (build_root / "Dockerfile").write_text(_dockerfile(payload), encoding="utf-8")
        tag = f"{_REPOSITORY}:{key}"
        platform_name = f"{payload['execution_os']}/{payload['architecture']}"
        if _BACKEND == "registry":
            return await asyncio.to_thread(_build_registry_environment, tag, platform_name, build_root)
        _require_backend("docker")
        try:
            await asyncio.to_thread(
                _docker,
                "build",
                "--pull=false",
                "--platform",
                platform_name,
                "--tag",
                tag,
                str(build_root),
                timeout=1800,
            )
            if _PUSH:
                await asyncio.to_thread(_docker, "push", tag, timeout=1800)
                pushed_image = await asyncio.to_thread(_repo_digest, tag)
                image = _pull_reference(pushed_image)
            else:
                image = await asyncio.to_thread(_docker, "image", "inspect", tag, "--format", "{{.Id}}")
                image = image.strip()
            size_bytes = int(await asyncio.to_thread(_docker, "image", "inspect", tag, "--format", "{{.Size}}"))
        except Exception:
            await asyncio.to_thread(_remove_local_reference, tag)
            raise
        if _PUSH:
            await asyncio.to_thread(_remove_local_reference, tag)
    if not _DIGEST_RE.fullmatch(image):
        raise HTTPException(status_code=502, detail="built image has no immutable digest")
    return {"image": image, "size_bytes": size_bytes}


@app.delete("/v1/environments/{key}")
async def delete_environment(key: str, request: DeleteEnvironmentRequest) -> dict[str, bool]:
    if not _KEY_RE.fullmatch(key):
        raise HTTPException(status_code=400, detail="invalid environment key")
    image = request.image.strip()
    if image and not _DIGEST_RE.fullmatch(image):
        raise HTTPException(status_code=400, detail="immutable image is required")
    if _BACKEND == "registry":
        if image:
            _, _, digest = image.rpartition("@")
            await asyncio.to_thread(_delete_registry_image, _digest_reference(_REPOSITORY, digest))
        return {"deleted": True}
    _require_backend("docker")
    if _PUSH:
        if not _REGISTRY_DELETE_URL:
            raise HTTPException(status_code=501, detail="pushed registry image deletion is not configured")
        await asyncio.to_thread(_delete_registry_manifest, image)
        return {"deleted": True}
    tag = f"{_REPOSITORY}:{key}"
    await asyncio.to_thread(_remove_local_image, tag, image)
    return {"deleted": True}


@app.post("/v1/commands/run")
async def run_command(request: CommandRequest) -> dict[str, str | int]:
    _require_backend("docker")
    command = _command_argv(request)
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            command,
            capture_output=True,
            text=True,
            timeout=request.timeout_seconds or None,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        if request.name:
            await asyncio.to_thread(_remove_command_container, request.name)
        return {
            "return_code": -1,
            "stdout": _bounded_output(exc.stdout),
            "stderr": _bounded_output(exc.stderr),
            "system_error": "command timed out",
        }
    except OSError as exc:
        return {"return_code": -1, "stdout": "", "stderr": "", "system_error": str(exc)}
    return {
        "return_code": completed.returncode,
        "stdout": _bounded_output(completed.stdout),
        "stderr": _bounded_output(completed.stderr),
        "system_error": "",
    }


def _command_argv(request: CommandRequest) -> list[str]:
    image = _validate_command_request(request)
    command = ["docker", "run", "--rm"]
    if _COMMAND_NETWORK:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,254}", _COMMAND_NETWORK):
            raise HTTPException(status_code=503, detail="command network is invalid")
        command.extend(["--network", _COMMAND_NETWORK])
    if request.name:
        command.extend(["--name", request.name])
    mount_args, mounted_paths = _command_mount_args(request.mounts)
    command.extend(mount_args)
    if request.cwd:
        if request.cwd.startswith(_COMMAND_STORAGE_ROOT) and not any(
            request.cwd == path or request.cwd.startswith(path + "/") for path in mounted_paths
        ):
            raise HTTPException(status_code=400, detail="command cwd is not covered by an authorized mount")
        command.extend(["--workdir", request.cwd])
    for name, value in request.env.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise HTTPException(status_code=400, detail=f"invalid environment variable name: {name}")
        command.extend(["--env", f"{name}={value}"])
    command.append(image)
    command.extend(request.argv)
    return command


def _validate_command_request(request: CommandRequest) -> str:
    if not request.argv or not all(isinstance(argument, str) and argument for argument in request.argv):
        raise HTTPException(status_code=400, detail="command argv must contain non-empty strings")
    image = request.image.strip() or _DEFAULT_COMMAND_IMAGE
    if not image:
        raise HTTPException(status_code=400, detail="command image is required")
    if request.timeout_seconds < 0:
        raise HTTPException(status_code=400, detail="command timeout must not be negative")
    if request.name and not re.fullmatch(r"[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?", request.name):
        raise HTTPException(status_code=400, detail="invalid command container name")
    if not _COMMAND_VOLUME:
        raise HTTPException(status_code=503, detail="command storage volume is not configured")
    for path in [request.cwd, *(mount.mount_path for mount in request.mounts)]:
        if path and not _allowed_command_path(path):
            raise HTTPException(status_code=400, detail=f"command path is outside allowed roots: {path}")
    return image


def _command_mount_args(mounts: list[CommandMountRequest]) -> tuple[list[str], set[str]]:
    arguments: list[str] = []
    mounted_paths: set[str] = set()
    for mount in mounts:
        path = posixpath.normpath(mount.mount_path)
        if path in mounted_paths:
            continue
        mounted_paths.add(path)
        relative = posixpath.relpath(path, _COMMAND_STORAGE_ROOT)
        mount_spec = f"type=volume,src={_COMMAND_VOLUME},dst={path}"
        if relative != ".":
            mount_spec += f",volume-subpath={relative}"
        if mount.read_only:
            mount_spec += ",readonly"
        arguments.extend(["--mount", mount_spec])
    return arguments, mounted_paths


def _allowed_command_path(value: str) -> bool:
    normalized = posixpath.normpath(value)
    if not posixpath.isabs(normalized):
        return False
    return normalized == _COMMAND_STORAGE_ROOT or normalized.startswith(_COMMAND_STORAGE_ROOT + "/") or (
        normalized == "/opt/sico-skill" or normalized.startswith("/opt/sico-skill/")
    )


def _bounded_output(value: str | bytes | None) -> str:
    if value is None:
        return ""
    text = value.decode(errors="replace") if isinstance(value, bytes) else value
    encoded = text.encode()[:_MAX_COMMAND_OUTPUT_BYTES]
    return encoded.decode(errors="replace")


def _remove_command_container(name: str) -> None:
    try:
        _docker("container", "rm", "--force", name, timeout=60)
    except HTTPException as exc:
        if "no such container" not in str(exc.detail).lower():
            raise


def _validate_spec(spec: Any) -> None:
    if not isinstance(spec, dict):
        raise HTTPException(status_code=400, detail="environment spec must be an object")
    base = str(spec.get("base_image_digest") or "")
    if not _DIGEST_RE.fullmatch(base):
        raise HTTPException(status_code=400, detail="base image must be immutable")
    steps = spec.get("preparation_steps")
    if not isinstance(steps, list) or not steps:
        raise HTTPException(status_code=400, detail="preparation steps are required")
    for step in steps:
        if not isinstance(step, dict) or not isinstance(step.get("argv"), list) or not step["argv"]:
            raise HTTPException(status_code=400, detail="invalid preparation step")
        if not all(isinstance(argument, str) and argument for argument in step["argv"]):
            raise HTTPException(status_code=400, detail="preparation argv must contain non-empty strings")
        if step.get("optional_argv"):
            raise HTTPException(status_code=400, detail="preparation steps must not have optional argv")
    runtime_digest = str(spec.get("runtime_digest") or "")
    if not re.fullmatch(r"[0-9a-f]{64}", runtime_digest):
        raise HTTPException(status_code=400, detail="invalid runtime digest")
    if spec.get("execution_os") != "linux" or spec.get("architecture") not in {"amd64", "arm64"}:
        raise HTTPException(status_code=400, detail="unsupported execution platform")


def _dockerfile(spec: dict[str, Any]) -> str:
    lines = [f"FROM {spec['base_image_digest']}", "WORKDIR /opt/sico-skill", "COPY runtime/ /opt/sico-skill/"]
    for step in spec["preparation_steps"]:
        cwd = str(step.get("cwd") or "").strip().replace("\\", "/")
        if cwd.startswith("/") or ".." in Path(cwd).parts:
            raise HTTPException(status_code=400, detail="preparation cwd must stay inside the skill runtime")
        workdir = "/opt/sico-skill" + (f"/{cwd}" if cwd and cwd != "." else "")
        command = ["sh", "-c", 'cd "$1" && shift && exec "$@"', "sico-preparation", workdir, *step["argv"]]
        lines.append(f"RUN {json.dumps(command, ensure_ascii=True)}")
    return "\n".join(lines) + "\n"


def _extract_runtime(archive: bytes, destination: Path) -> None:
    archive_path = destination.parent / "runtime.tar"
    archive_path.write_bytes(archive)
    try:
        with tarfile.open(archive_path, mode="r") as stream:
            members = stream.getmembers()
            if any(not (member.isfile() or member.isdir()) for member in members):
                raise HTTPException(status_code=400, detail="runtime archive contains unsupported entries")
            if sum(member.size for member in members) > _MAX_CONTEXT_BYTES:
                raise HTTPException(status_code=413, detail="expanded build context is too large")
            stream.extractall(destination, filter="data")
    except HTTPException:
        raise
    except (tarfile.TarError, OSError) as exc:
        raise HTTPException(status_code=400, detail="invalid runtime archive") from exc
    finally:
        archive_path.unlink(missing_ok=True)


def _runtime_content_digest(runtime_root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(runtime_root.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(runtime_root).as_posix()
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(str(path.stat().st_mode & 0o777).encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _repo_digest(tag: str) -> str:
    digests = json.loads(_docker("image", "inspect", tag, "--format", "{{json .RepoDigests}}"))
    if not digests:
        raise HTTPException(status_code=502, detail="pushed image has no repository digest")
    return str(digests[0])


def _pull_reference(pushed_image: str) -> str:
    _, separator, digest = pushed_image.rpartition("@")
    if not separator or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise HTTPException(status_code=502, detail="pushed image has no valid manifest digest")
    return f"{_PULL_REPOSITORY}@{digest}"


def _build_registry_environment(tag: str, platform_name: str, build_root: Path) -> dict[str, str | int]:
    digest = _try_registry_image_digest(tag)
    if not digest:
        _ensure_registry_access(tag)
        output = f"type=image,name={tag},push=true"
        if _REGISTRY_INSECURE:
            output += ",registry.insecure=true"
        _tool(
            "buildctl",
            "--addr",
            _BUILDKIT_ADDRESS,
            "build",
            "--frontend",
            "dockerfile.v0",
            "--local",
            f"context={build_root}",
            "--local",
            f"dockerfile={build_root}",
            "--opt",
            "filename=Dockerfile",
            "--opt",
            f"platform={platform_name}",
            "--output",
            output,
            timeout=1800,
        )
        digest = _registry_image_digest(tag)
    image = _digest_reference(_PULL_REPOSITORY or tag, digest)
    return {"image": image, "size_bytes": _registry_image_size(_digest_reference(tag, digest))}


def _registry_image_digest(image: str) -> str:
    digest = _try_registry_image_digest(image)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise HTTPException(status_code=502, detail=f"unable to resolve registry image digest: {image}")
    return digest


def _try_registry_image_digest(image: str) -> str:
    _ensure_registry_access(image)
    try:
        return _tool("regctl", "image", "digest", image, timeout=300).strip()
    except HTTPException as exc:
        if exc.status_code == 502:
            return ""
        raise


def _registry_image_size(image: str) -> int:
    manifest = json.loads(_tool("regctl", "manifest", "get", image, "--format", "raw-body", timeout=300))
    if manifests := manifest.get("manifests"):
        architecture = os.getenv("PREPARED_ENV_ARCHITECTURE", "amd64")
        descriptor = next(
            (item for item in manifests if item.get("platform", {}).get("architecture") == architecture),
            manifests[0],
        )
        return _registry_image_size(_digest_reference(image, str(descriptor["digest"])))
    config_size = int(manifest.get("config", {}).get("size") or 0)
    return config_size + sum(int(layer.get("size") or 0) for layer in manifest.get("layers") or [])


def _delete_registry_image(image: str) -> None:
    _ensure_registry_access(image)
    try:
        _tool("regctl", "image", "delete", image, timeout=300)
    except HTTPException as exc:
        if "not found" not in str(exc.detail).lower():
            raise


def _digest_reference(image: str, digest: str) -> str:
    name = image.split("@", 1)[0]
    slash = name.rfind("/")
    colon = name.rfind(":")
    if colon > slash:
        name = name[:colon]
    return f"{name}@{digest}"


def _ensure_registry_access(image: str) -> None:
    registry = _registry_host(image)
    if _REGISTRY_INSECURE and registry == _registry_host(_REPOSITORY):
        _tool("regctl", "registry", "set", registry, "--tls", "disabled", timeout=60)
    if not _AZURE_REGISTRY_AUTH or not registry.endswith(".azurecr.io") or registry in _AUTHENTICATED_REGISTRIES:
        return
    try:
        from azure.identity import DefaultAzureCredential
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="azure-identity is required for ACR authentication") from exc
    token = DefaultAzureCredential().get_token("https://management.azure.com/.default")
    response = requests.post(
        f"https://{registry}/oauth2/exchange",
        data={
            "grant_type": "access_token",
            "service": registry,
            "tenant": os.getenv("AZURE_TENANT_ID", ""),
            "access_token": token.token,
        },
        timeout=30,
    )
    response.raise_for_status()
    refresh_token = str(response.json().get("refresh_token") or "")
    if not refresh_token:
        raise HTTPException(status_code=502, detail="ACR token exchange returned no refresh token")
    username = "00000000-0000-0000-0000-000000000000"
    auth = base64.b64encode(f"{username}:{refresh_token}".encode()).decode()
    docker_config = Path("/tmp/sico-registry-auth")
    docker_config.mkdir(parents=True, exist_ok=True)
    (docker_config / "config.json").write_text(
        json.dumps({"auths": {registry: {"auth": auth}}}),
        encoding="utf-8",
    )
    os.environ["DOCKER_CONFIG"] = str(docker_config)
    _AUTHENTICATED_REGISTRIES.add(registry)


def _registry_host(image: str) -> str:
    first = image.split("/", 1)[0]
    if "." in first or ":" in first or first == "localhost":
        return first
    return "docker.io"


def _buildkit_reachable() -> bool:
    address = _BUILDKIT_ADDRESS.removeprefix("tcp://")
    host, separator, port = address.rpartition(":")
    if not separator or not host:
        return False
    try:
        with socket.create_connection((host, int(port)), timeout=2):
            return True
    except (OSError, ValueError):
        return False


def _require_backend(expected: str) -> None:
    if _BACKEND != expected:
        raise HTTPException(status_code=501, detail=f"operation is unavailable with prepared environment backend: {_BACKEND}")


def _tool(*args: str, timeout: int) -> str:
    try:
        completed = subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"{args[0]} operation timed out") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or f"{args[0]} operation failed")[-4000:]
        raise HTTPException(status_code=502, detail=detail) from exc
    return completed.stdout.strip()


def _delete_registry_manifest(image: str) -> None:
    _, separator, digest = image.rpartition("@")
    if not separator or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise HTTPException(status_code=400, detail="invalid prepared image digest")
    url = _REGISTRY_DELETE_URL.replace("{digest}", digest)
    response = requests.delete(url, headers={"Accept": "application/vnd.oci.image.manifest.v1+json"}, timeout=300)
    if response.status_code in {202, 404}:
        return
    raise HTTPException(status_code=502, detail=f"registry deletion failed with status {response.status_code}")


def _remove_local_image(tag: str, image: str = "") -> None:
    try:
        tagged_image = _docker("image", "inspect", tag, "--format", "{{.Id}}", timeout=60).strip()
    except HTTPException as exc:
        if "no such image" in str(exc.detail).lower():
            return
        raise
    if image and tagged_image != image:
        raise HTTPException(status_code=409, detail="prepared environment tag does not match requested image")
    _remove_local_reference(tag)
    _remove_local_reference(tagged_image, ignore_in_use=True)


def _remove_local_reference(reference: str, *, ignore_in_use: bool = False) -> None:
    try:
        _docker("image", "rm", reference, timeout=300)
    except HTTPException as exc:
        detail = str(exc.detail).lower()
        allowed = "no such image" in detail or (ignore_in_use and "image is being used" in detail)
        if not allowed:
            raise


def _docker(*args: str, timeout: int = 60) -> str:
    try:
        completed = subprocess.run(
            ["docker", *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="docker operation timed out") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "docker operation failed")[-4000:]
        raise HTTPException(status_code=502, detail=detail) from exc
    return completed.stdout.strip()
