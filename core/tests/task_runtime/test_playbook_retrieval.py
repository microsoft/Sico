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

from types import SimpleNamespace

from app.biz.task_runtime.models import SkillDispatch, TaskSpec
from app.biz.task_runtime import playbook_retrieval
from app.biz.task_runtime.playbook_retrieval import (
    PlaybookHint,
    PlaybookRetrievalOptions,
    PlaybookRetriever,
    wrap_experience_for_agent,
    attach_playbook_hints,
)
from app.experiences.playbook import Playbook


def _skill_task(
    *,
    skill_name: str,
    title: str,
    instructions: str = "",
    required_sandbox: str | None = None,
    metadata: dict | None = None,
) -> TaskSpec:
    return TaskSpec(
        task_id="case-1",
        title=title,
        instructions=instructions,
        dispatch=SkillDispatch(skill_name=skill_name),
        required_sandbox=required_sandbox,
        metadata=metadata or {},
    )


def test_retriever_prefers_android_scoped_hints() -> None:
    playbook = Playbook()
    playbook.add_bullet("android/pre-exec", "For Android sign-in, wait for the password page before typing the password.")
    playbook.add_bullet("web/general", "For web tests, inspect the DOM before clicking.")
    task = _skill_task(
        skill_name="android-test",
        title="MSA sign-in",
        required_sandbox="android",
        instructions="Launch Copilot and sign in with MSA credentials.",
    )

    hints = PlaybookRetriever().retrieve_from_playbook(playbook=playbook, task=task, limit=1)

    assert len(hints) == 1
    assert hints[0].section == "android/pre-exec"
    assert "password page" in hints[0].text


def test_wrap_experience_for_agent_adds_bullet_ids() -> None:
    hints = [
        PlaybookHint(
            bullet_id="android/pre-exec-1",
            section="android/pre-exec",
            text="Tap Next after entering the email before typing password.",
            score=0.5,
            helpful=2,
            harmful=0,
        )
    ]

    enriched = wrap_experience_for_agent("Run sign-in.", hints)

    assert "[android/pre-exec-1]" in enriched
    assert "Learned Experience" in enriched
    assert "(✓" in enriched and "✗" in enriched
    assert "According to [ID]" in enriched


def test_tail_trim_keeps_head_and_drops_low_helpful(monkeypatch) -> None:
    playbook = Playbook()
    items = [playbook.add_bullet("s", f"note {i}") for i in range(15)]
    for i, bullet in enumerate(items):
        bullet.helpful = 5 if i in (11, 13) else 0
    ranked = [(bullet, 1.0 - i * 0.01) for i, bullet in enumerate(items)]
    monkeypatch.setattr(playbook_retrieval, "_relevance_ranked", lambda playbook, task: ranked)

    options = PlaybookRetrievalOptions(limit=30, head_keep=10, tail_min_helpful=2)
    hints = PlaybookRetriever(options=options).retrieve_from_playbook(
        playbook=playbook,
        task=_skill_task(skill_name="android-tester", title="x", instructions="y"),
    )

    ids = [hint.bullet_id for hint in hints]
    assert ids == [bullet.id for bullet in items[:10]] + [items[11].id, items[13].id]


def _stub_hints(monkeypatch, hints: list[PlaybookHint]) -> None:
    monkeypatch.setenv("EXPERIENCES_ENABLED", "true")
    monkeypatch.setattr(
        PlaybookRetriever,
        "retrieve",
        lambda self, *, agent_instance_id, task, limit=None: list(hints),
    )


def test_attach_enriches_both_field_and_args_instructions(monkeypatch) -> None:
    # Strict-schema skills (android-tester) take their instructions as an explicit
    # args["instructions"] parameter; the experience must reach that, not just the field.
    hint = PlaybookHint(
        bullet_id="android/pre-exec-00001",
        section="android/pre-exec",
        text="Wait for the password page before typing.",
        score=0.5,
        helpful=2,
        harmful=0,
    )
    _stub_hints(monkeypatch, [hint])
    task = _skill_task(
        skill_name="android-tester",
        title="MSA sign-in",
        required_sandbox="android",
        instructions="Launch Copilot and sign in.",
    ).model_copy(update={"args": {"instructions": "Step 1: open app. Step 2: sign in."}})

    enriched = attach_playbook_hints(SimpleNamespace(agent_instance_id=2), task)

    # The args["instructions"] the skill actually runs is enriched, with the original kept.
    assert "Learned Experience" in enriched.args["instructions"]
    assert "[android/pre-exec-00001]" in enriched.args["instructions"]
    assert "Step 1: open app" in enriched.args["instructions"]
    # The field is enriched too (used by task_context when args has no instructions).
    assert "Learned Experience" in enriched.instructions
    assert enriched.args["playbook_shown_bullet_ids"] == ["android/pre-exec-00001"]
    # The input task is never mutated.
    assert task.args["instructions"] == "Step 1: open app. Step 2: sign in."


def test_attach_enriches_field_only_when_no_args_instructions(monkeypatch) -> None:
    hint = PlaybookHint(bullet_id="b-1", section="s", text="t", score=0.5, helpful=1, harmful=0)
    _stub_hints(monkeypatch, [hint])
    task = _skill_task(
        skill_name="sub-agent-skill",
        title="x",
        required_sandbox="android",
        instructions="do it",
    )

    enriched = attach_playbook_hints(SimpleNamespace(agent_instance_id=2), task)

    assert "Learned Experience" in enriched.instructions
    assert "instructions" not in enriched.args


def test_attach_no_hints_returns_task_untouched(monkeypatch) -> None:
    _stub_hints(monkeypatch, [])
    task = _skill_task(skill_name="android-tester", title="x", required_sandbox="android", instructions="do it")

    enriched = attach_playbook_hints(SimpleNamespace(agent_instance_id=2), task)

    assert enriched is task


def test_attach_retrieval_failure_returns_task_untouched(monkeypatch) -> None:
    monkeypatch.setenv("EXPERIENCES_ENABLED", "true")

    def _boom(self, *, agent_instance_id, task, limit=None):
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(PlaybookRetriever, "retrieve", _boom)
    task = _skill_task(skill_name="android-tester", title="x", required_sandbox="android", instructions="do it")

    enriched = attach_playbook_hints(SimpleNamespace(agent_instance_id=2), task)

    assert enriched is task


def test_attach_skips_when_experiences_disabled(monkeypatch) -> None:
    monkeypatch.setenv("EXPERIENCES_ENABLED", "false")
    hint = PlaybookHint(bullet_id="b-1", section="s", text="t", score=0.5, helpful=1, harmful=0)
    monkeypatch.setattr(
        PlaybookRetriever,
        "retrieve",
        lambda self, *, agent_instance_id, task, limit=None: [hint],
    )
    task = _skill_task(skill_name="android-tester", title="x", required_sandbox="android", instructions="do it")

    enriched = attach_playbook_hints(SimpleNamespace(agent_instance_id=2), task)

    assert enriched is task
