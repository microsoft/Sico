from __future__ import annotations

import io
import importlib.util
import json
import tarfile
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi import UploadFile


def _load_runner_module():
    path = Path(__file__).parents[3] / "deployments" / "environment-runner" / "app.py"
    spec = importlib.util.spec_from_file_location("sico_environment_runner", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _spec(*, cwd: str = "") -> dict:
    return {
        "base_image_digest": "registry.test/base@sha256:" + "1" * 64,
        "runtime_digest": "2" * 64,
        "execution_os": "linux",
        "architecture": "amd64",
        "preparation_steps": [
            {
                "argv": ["sh", "scripts/install tool.sh", "value with spaces; echo unsafe"],
                "optional_argv": [],
                "cwd": cwd,
            }
        ],
    }


def test_environment_runner_generates_argv_safe_preparation_commands() -> None:
    runner = _load_runner_module()

    dockerfile = runner._dockerfile(_spec(cwd="tools"))

    assert dockerfile.startswith("FROM registry.test/base@sha256:")
    assert "WORKDIR /opt/sico-skill" in dockerfile
    command = dockerfile.splitlines()[-1]
    assert command.startswith("RUN [")
    argv = json.loads(command.removeprefix("RUN "))
    assert argv == [
        "sh",
        "-c",
        'cd "$1" && shift && exec "$@"',
        "sico-preparation",
        "/opt/sico-skill/tools",
        "sh",
        "scripts/install tool.sh",
        "value with spaces; echo unsafe",
    ]


@pytest.mark.parametrize("cwd", ["/root", "../outside", "tools/../../outside"])
def test_environment_runner_rejects_cwd_outside_runtime(cwd: str) -> None:
    runner = _load_runner_module()

    with pytest.raises(HTTPException, match="preparation cwd"):
        runner._dockerfile(_spec(cwd=cwd))


def test_environment_runner_rejects_archive_links(tmp_path: Path) -> None:
    runner = _load_runner_module()
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w") as archive:
        link = tarfile.TarInfo("linked-runtime")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc"
        archive.addfile(link)

    with pytest.raises(HTTPException, match="unsupported entries"):
        runner._extract_runtime(payload.getvalue(), tmp_path)


@pytest.mark.asyncio
async def test_environment_runner_deletes_local_image_by_key_and_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_PUSH", False)
    removed: list[tuple[str, str]] = []
    monkeypatch.setattr(runner, "_remove_local_image", lambda tag, image: removed.append((tag, image)))
    key = "a" * 64
    image = "sha256:" + "b" * 64

    result = await runner.delete_environment(key, runner.DeleteEnvironmentRequest(image=image))

    assert result == {"deleted": True}
    assert removed == [(f"sico-prepared-environment:{key}", image)]


@pytest.mark.asyncio
async def test_environment_runner_rejects_registry_deletion_without_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_PUSH", True)

    with pytest.raises(HTTPException) as exc_info:
        await runner.delete_environment(
            "a" * 64,
            runner.DeleteEnvironmentRequest(image="registry.test/prepared@sha256:" + "b" * 64),
        )

    assert exc_info.value.status_code == 501


def test_environment_runner_rewrites_pushed_digest_for_worker_pull(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_PULL_REPOSITORY", "localhost:5000/sico/prepared-environment")

    result = runner._pull_reference("172.18.0.2:5000/sico/prepared-environment@sha256:" + "a" * 64)

    assert result == "localhost:5000/sico/prepared-environment@sha256:" + "a" * 64


def test_registry_runner_resolves_immutable_base_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_BACKEND", "registry")
    monkeypatch.setattr(runner, "_registry_image_digest", lambda _image: "sha256:" + "a" * 64)

    result = runner.resolve_image(runner.ImageRequest(image="alpine:3.21"))

    assert result == {"image": "alpine@sha256:" + "a" * 64}


def test_insecure_registry_configuration_does_not_apply_to_public_base(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_REGISTRY_INSECURE", True)
    monkeypatch.setattr(runner, "_REPOSITORY", "registry.local:5000/sico/prepared")
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(runner, "_tool", lambda *args, timeout: calls.append(args) or "")

    runner._ensure_registry_access("alpine:3.21")
    runner._ensure_registry_access("registry.local:5000/sico/prepared:key")

    assert calls == [("regctl", "registry", "set", "registry.local:5000", "--tls", "disabled")]


def test_registry_runner_builds_and_reports_published_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_BUILDKIT_ADDRESS", "tcp://buildkit:1234")
    monkeypatch.setattr(runner, "_PULL_REPOSITORY", "registry.test/prepared")
    digests = iter(("", "sha256:" + "b" * 64))
    monkeypatch.setattr(runner, "_try_registry_image_digest", lambda _image: next(digests))
    monkeypatch.setattr(runner, "_ensure_registry_access", lambda _image: None)
    monkeypatch.setattr(runner, "_registry_image_size", lambda _image: 123)
    calls: list[tuple[str, ...]] = []
    monkeypatch.setattr(runner, "_tool", lambda *args, timeout: calls.append(args) or "")

    result = runner._build_registry_environment(
        "registry.test/prepared:key",
        "linux/amd64",
        tmp_path,
    )

    assert result == {
        "image": "registry.test/prepared@sha256:" + "b" * 64,
        "size_bytes": 123,
    }
    assert calls[0][:4] == ("buildctl", "--addr", "tcp://buildkit:1234", "build")
    assert "type=image,name=registry.test/prepared:key,push=true" in calls[0]


@pytest.mark.asyncio
async def test_registry_runner_deletes_published_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_BACKEND", "registry")
    monkeypatch.setattr(runner, "_REPOSITORY", "registry.internal/prepared")
    deleted: list[str] = []
    monkeypatch.setattr(runner, "_delete_registry_image", deleted.append)
    image = "worker.registry/prepared@sha256:" + "c" * 64

    result = await runner.delete_environment("a" * 64, runner.DeleteEnvironmentRequest(image=image))

    assert result == {"deleted": True}
    assert deleted == ["registry.internal/prepared@sha256:" + "c" * 64]


def test_environment_runner_registry_delete_is_idempotent(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(
        runner,
        "_REGISTRY_DELETE_URL",
        "http://registry:5000/v2/sico/prepared-environment/manifests/{digest}",
    )

    class Response:
        status_code = 404

    calls: list[str] = []
    monkeypatch.setattr(runner.requests, "delete", lambda url, **kwargs: calls.append(url) or Response())

    runner._delete_registry_manifest("localhost:5000/sico/prepared-environment@sha256:" + "b" * 64)

    assert calls == [
        "http://registry:5000/v2/sico/prepared-environment/manifests/sha256:" + "b" * 64
    ]


def test_environment_runner_rejects_mismatched_local_image(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_docker", lambda *args, **kwargs: "sha256:" + "c" * 64)

    with pytest.raises(HTTPException) as exc_info:
        runner._remove_local_image("sico-prepared-environment:key", "sha256:" + "d" * 64)

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_environment_runner_build_returns_size_and_cleans_failed_tag(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    runner = _load_runner_module()
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    script = runtime / "run.py"
    script.write_text("print('ok')\n", encoding="utf-8")
    script.chmod(0o644)
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode="w") as archive:
        archive.add(script, arcname="run.py")
    spec = _spec()
    spec["runtime_digest"] = runner._runtime_content_digest(runtime)
    key = runner.hashlib.sha256(
        json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    ).hexdigest()
    calls: list[tuple[str, ...]] = []

    def docker(*args: str, timeout: int = 60) -> str:
        calls.append(args)
        if "{{.Id}}" in args:
            return "sha256:" + "c" * 64
        if "{{.Size}}" in args:
            return "123"
        return ""

    monkeypatch.setattr(runner, "_docker", docker)
    result = await runner.build_environment(
        key,
        json.dumps(spec),
        UploadFile(file=io.BytesIO(payload.getvalue()), filename="runtime.tar"),
    )

    assert result == {"image": "sha256:" + "c" * 64, "size_bytes": 123}
    assert any("--platform" in call and "linux/amd64" in call for call in calls)

    removed: list[str] = []
    monkeypatch.setattr(runner, "_remove_local_reference", removed.append)

    def failed_docker(*args: str, timeout: int = 60) -> str:
        raise HTTPException(status_code=502, detail="build failed")

    monkeypatch.setattr(runner, "_docker", failed_docker)
    with pytest.raises(HTTPException, match="build failed"):
        await runner.build_environment(
            key,
            json.dumps(spec),
            UploadFile(file=io.BytesIO(payload.getvalue()), filename="runtime.tar"),
        )

    assert removed == [f"sico-prepared-environment:{key}"]


def test_environment_runner_command_uses_authorized_volume_subpaths(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_COMMAND_VOLUME", "sico-core-storage")
    monkeypatch.setattr(runner, "_COMMAND_STORAGE_ROOT", "/mnt/storage")
    request = runner.CommandRequest(
        argv=["python", "run.py"],
        image="sha256:" + "a" * 64,
        cwd="/mnt/storage/chat/work/run",
        mounts=[
            {"mount_path": "/mnt/storage/chat/work", "read_only": True},
            {"mount_path": "/mnt/storage/chat/results", "read_only": False},
        ],
        name="skill-run-1",
    )

    command = runner._command_argv(request)

    assert "type=volume,src=sico-core-storage,dst=/mnt/storage/chat/work,volume-subpath=chat/work,readonly" in command
    assert "type=volume,src=sico-core-storage,dst=/mnt/storage/chat/results,volume-subpath=chat/results" in command
    assert command[-3:] == ["sha256:" + "a" * 64, "python", "run.py"]


@pytest.mark.parametrize(
    ("network", "expected"),
    [
        ("", ["docker", "run", "--rm"]),
        ("sico_sico", ["docker", "run", "--rm", "--network", "sico_sico"]),
    ],
)
def test_environment_runner_command_uses_configured_network(
    monkeypatch: pytest.MonkeyPatch,
    network: str,
    expected: list[str],
) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_COMMAND_VOLUME", "sico-core-storage")
    monkeypatch.setattr(runner, "_COMMAND_NETWORK", network)

    command = runner._command_argv(
        runner.CommandRequest(argv=["true"], image="sha256:" + "a" * 64)
    )

    assert command[: len(expected)] == expected


def test_environment_runner_command_rejects_unauthorized_path(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_COMMAND_VOLUME", "sico-core-storage")
    monkeypatch.setattr(runner, "_COMMAND_STORAGE_ROOT", "/mnt/storage")

    with pytest.raises(HTTPException, match="outside allowed roots"):
        runner._command_argv(
            runner.CommandRequest(
                argv=["cat", "/etc/passwd"],
                image="sha256:" + "a" * 64,
                cwd="/etc",
            )
        )


@pytest.mark.asyncio
async def test_environment_runner_removes_timed_out_container(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _load_runner_module()
    monkeypatch.setattr(runner, "_COMMAND_VOLUME", "sico-core-storage")
    monkeypatch.setattr(runner, "_COMMAND_STORAGE_ROOT", "/mnt/storage")
    removed: list[str] = []
    monkeypatch.setattr(runner, "_remove_command_container", removed.append)

    def timeout(*args, **kwargs):
        raise runner.subprocess.TimeoutExpired(args[0], 1, output="partial", stderr="late")

    monkeypatch.setattr(runner.subprocess, "run", timeout)
    result = await runner.run_command(
        runner.CommandRequest(
            argv=["sleep", "10"],
            image="sha256:" + "a" * 64,
            name="skill-timeout",
            timeout_seconds=1,
        )
    )

    assert result["return_code"] == -1
    assert result["system_error"] == "command timed out"
    assert removed == ["skill-timeout"]
