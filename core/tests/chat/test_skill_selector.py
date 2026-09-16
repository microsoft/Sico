from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.biz.chat.skill_selector import select_skill_guides
from app.biz.task_runtime.guides import SkillGuideRegistry


def _registry(tmp_path: Path) -> SkillGuideRegistry:
    workspace = tmp_path / "workspace"
    (workspace / "skills").mkdir(parents=True)
    (workspace / "skills" / "index.json").write_text(
        json.dumps(
            [
                {"id": 6, "name": "writing-prds", "description": "Help users write effective PRDs."},
                {"id": 7, "name": "setting-okrs", "description": "Help users set effective OKRs."},
            ]
        ),
        encoding="utf-8",
    )
    for skill_id, marker in ((6, "PRD_GUIDE"), (7, "OKR_GUIDE")):
        guide_root = tmp_path / "skills" / str(skill_id) / "resolved" / "cortex"
        guide_root.mkdir(parents=True)
        (guide_root / "SKILL.md").write_text(
            f"# Guide\n{marker}\n" + ("Follow this workflow. " * 30),
            encoding="utf-8",
        )
    return SkillGuideRegistry(workspace)


@pytest.mark.asyncio
async def test_semantic_selector_resolves_authorized_guide_refs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen_payloads: list[dict] = []

    async def generate(*, request):
        seen_payloads.append(json.loads(request.inputs[0].content[0].text))
        return SimpleNamespace(
            code=0,
            msg="",
            outputs=[SimpleNamespace(json={"skill_ids": [6, 999, 6], "reason": "PRD request"}, text="")],
            text="",
        )

    monkeypatch.setattr("app.biz.chat.skill_selector.app.llmhubs.generate", generate)

    selected = await select_skill_guides(
        _registry(tmp_path),
        "Please try the four subagents again",
        prior_conversation="User: Create four imaginary product requirement documents.",
    )

    assert len(selected) == 1
    assert selected[0].descriptor.name == "writing-prds"
    assert "PRD_GUIDE" in selected[0].content
    assert "product requirement documents" in seen_payloads[0]["recent_prior_conversation"]


@pytest.mark.asyncio
async def test_explicit_selector_precedes_semantic_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def unexpected_generate(*, request):
        raise AssertionError("semantic model must not run for explicit activation")

    monkeypatch.setattr("app.biz.chat.skill_selector.app.llmhubs.generate", unexpected_generate)

    selected = await select_skill_guides(_registry(tmp_path), "/writing-prds Create a PRD")

    assert [guide.descriptor.name for guide in selected] == ["writing-prds"]


@pytest.mark.asyncio
async def test_semantic_selector_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_generate(*, request):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr("app.biz.chat.skill_selector.app.llmhubs.generate", failing_generate)

    assert await select_skill_guides(_registry(tmp_path), "Create a PRD") == ()


@pytest.mark.asyncio
async def test_semantic_selector_rejects_malformed_structured_output(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def generate(*, request):
        return SimpleNamespace(
            code=0,
            msg="",
            outputs=[SimpleNamespace(json={"skill_ids": "writing-prds"}, text="")],
            text="",
        )

    monkeypatch.setattr("app.biz.chat.skill_selector.app.llmhubs.generate", generate)

    assert await select_skill_guides(_registry(tmp_path), "Create a PRD") == ()
