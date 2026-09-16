from __future__ import annotations

import pytest

from app.biz.task_runtime.execution.command.contracts import CommandMount, CommandSpec
from app.biz.task_runtime.execution.command.runner import EnvironmentRunnerBackend


class _Response:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return {"return_code": 0, "stdout": "ok\n", "stderr": "", "system_error": ""}


@pytest.mark.asyncio
async def test_environment_runner_backend_projects_command_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, dict[str, object], int]] = []

    def post(url: str, *, json: dict[str, object], timeout: int) -> _Response:
        calls.append((url, json, timeout))
        return _Response()

    monkeypatch.setattr("app.biz.task_runtime.execution.command.runner.requests.post", post)
    backend = EnvironmentRunnerBackend("http://environment-runner:8080")
    session = backend.open_session(pod_name="skill-one", image="sha256:" + "a" * 64)

    result = await session.run(
        CommandSpec(
            argv=["echo", "ok"],
            cwd="/mnt/storage/chat/work",
            env={"SICO_TEST": "yes"},
            mounts=[CommandMount("work", "/ignored", "/mnt/storage/chat/work", read_only=True)],
            timeout_seconds=12,
        )
    )

    assert result.stdout == "ok\n"
    assert calls == [
        (
            "http://environment-runner:8080/v1/commands/run",
            {
                "argv": ["echo", "ok"],
                "image": "sha256:" + "a" * 64,
                "cwd": "/mnt/storage/chat/work",
                "env": {"SICO_TEST": "yes"},
                "mounts": [{"mount_path": "/mnt/storage/chat/work", "read_only": True}],
                "timeout_seconds": 12,
                "name": "skill-one",
            },
            42,
        )
    ]
