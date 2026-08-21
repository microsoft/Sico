from __future__ import annotations

import asyncio

import pytest

import app.biz.task_runtime.orchestration.recovery as stale_reconciler


@pytest.mark.asyncio
async def test_startup_reconciler_runs_immediate_and_delayed_pass(monkeypatch) -> None:
    calls: list[str] = []

    async def reconcile_once() -> None:
        calls.append("reconcile")

    monkeypatch.setattr(stale_reconciler, "reconcile_stale_task_runtime_once", reconcile_once)
    monkeypatch.setattr(stale_reconciler, "_startup_reconcile_delay_seconds", lambda: 0.001)

    await stale_reconciler.run_task_runtime_startup_reconciler(asyncio.Event())

    assert calls == ["reconcile", "reconcile"]


@pytest.mark.asyncio
async def test_startup_reconciler_skips_delayed_pass_when_stopping(monkeypatch) -> None:
    calls: list[str] = []

    async def reconcile_once() -> None:
        calls.append("reconcile")

    monkeypatch.setattr(stale_reconciler, "reconcile_stale_task_runtime_once", reconcile_once)
    monkeypatch.setattr(stale_reconciler, "_startup_reconcile_delay_seconds", lambda: 60)
    stop_event = asyncio.Event()
    stop_event.set()

    await stale_reconciler.run_task_runtime_startup_reconciler(stop_event)

    assert calls == ["reconcile"]
