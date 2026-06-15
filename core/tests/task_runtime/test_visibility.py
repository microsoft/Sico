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

"""Tests for CapabilityCard visibility + SkillLoader.list_cards filtering."""

from __future__ import annotations

from pathlib import Path

from app.biz.task_runtime.skill_loader import CapabilityCard, SkillLoader


def _seed_resolver_with_cards(*cards: CapabilityCard) -> SkillLoader:
    resolver = SkillLoader(workspace_root=Path("/tmp/does-not-matter"))
    resolver._cards = {card.name: card for card in cards}
    return resolver


def test_capability_card_defaults_to_public_visibility() -> None:
    card = CapabilityCard(name="alpha")
    assert card.visibility == "public"


def test_list_cards_defaults_to_public_only() -> None:
    resolver = _seed_resolver_with_cards(
        CapabilityCard(name="public-1", visibility="public"),
        CapabilityCard(name="internal-1", visibility="internal"),
        CapabilityCard(name="public-2", visibility="public"),
    )

    cards = resolver.list_cards()
    names = sorted(card.name for card in cards)
    assert names == ["public-1", "public-2"]


def test_list_cards_internal_filter() -> None:
    resolver = _seed_resolver_with_cards(
        CapabilityCard(name="public-1", visibility="public"),
        CapabilityCard(name="internal-1", visibility="internal"),
    )

    cards = resolver.list_cards(visibility="internal")
    assert [card.name for card in cards] == ["internal-1"]


def test_list_cards_any_returns_all() -> None:
    resolver = _seed_resolver_with_cards(
        CapabilityCard(name="public-1", visibility="public"),
        CapabilityCard(name="internal-1", visibility="internal"),
    )

    cards = resolver.list_cards(visibility="any")
    assert sorted(card.name for card in cards) == ["internal-1", "public-1"]


def test_resolve_works_regardless_of_visibility() -> None:
    """Visibility only filters discovery; explicit resolution always succeeds."""
    resolver = _seed_resolver_with_cards(
        CapabilityCard(name="public-1", visibility="public"),
        CapabilityCard(name="internal-1", visibility="internal"),
    )

    assert resolver.resolve("internal-1") is not None
    assert resolver.resolve("public-1") is not None
    assert resolver.resolve("missing") is None


def test_render_cards_section_omits_internal_cards() -> None:
    """The Lead Planner LLM never sees ``visibility="internal"`` cards."""
    resolver = _seed_resolver_with_cards(
        CapabilityCard(name="public-skill", skill_name="public-skill", action_name="run", visibility="public"),
        CapabilityCard(name="internal-skill", skill_name="internal-skill", action_name="run", visibility="internal"),
    )

    rendered = resolver.render_cards_section()
    assert "public-skill" in rendered
    assert "internal-skill" not in rendered
