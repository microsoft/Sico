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

"""Accessibility tree: parse, find and match UI nodes."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")

_BOUNDS_TOLERANCE_PX = 50
"""Max per-axis pixel drift allowed when matching recorded bounds."""


@dataclass(slots=True)
class UINode:
    """A single element from a uiautomator accessibility dump."""

    text: str
    resource_id: str
    content_desc: str
    cls: str
    package: str
    bounds: tuple[int, int, int, int]
    clickable: bool
    depth: int = 0
    xpath: str = ""
    index: int = 0
    enabled: bool = True
    focusable: bool = False
    scrollable: bool = False
    selected: bool = False
    checked: bool = False
    checkable: bool = False
    focused: bool = False

    @property
    def label(self) -> str:
        return self.text or self.content_desc or self.resource_id or ""

    @property
    def is_identifiable(self) -> bool:
        return bool(self.text or self.content_desc or self.resource_id)

    @property
    def center(self) -> tuple[int, int]:
        left, top, right, bottom = self.bounds
        return (left + right) // 2, (top + bottom) // 2

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "resource_id": self.resource_id,
            "content_desc": self.content_desc,
            "class": self.cls,
            "package": self.package,
            "bounds": list(self.bounds),
            "clickable": self.clickable,
            "xpath": self.xpath,
            "index": self.index,
            "enabled": self.enabled,
            "focusable": self.focusable,
            "scrollable": self.scrollable,
            "selected": self.selected,
            "checked": self.checked,
            "checkable": self.checkable,
            "focused": self.focused,
        }


# ---------------------------------------------------------------------------
# Dump + parse
# ---------------------------------------------------------------------------


def _build_parent_map(
    root: ET.Element,
) -> dict[ET.Element, ET.Element]:
    return {c: p for p in root.iter() for c in p}


def _parse_bounds(raw: str) -> tuple[int, int, int, int] | None:
    m = _BOUNDS_RE.match(raw)
    if not m:
        return None
    return int(m[1]), int(m[2]), int(m[3]), int(m[4])


def _build_xpath(
    el: ET.Element, parent_map: dict[ET.Element, ET.Element],
) -> str:
    parts: list[str] = []
    current = el
    while current in parent_map:
        parent = parent_map[current]
        idx = list(parent).index(current)
        parts.append(f"node[{idx}]")
        current = parent
    parts.append(current.tag)
    parts.reverse()
    return "/" + "/".join(parts)


def _el_to_node(
    el: ET.Element, depth: int,
    parent_map: dict[ET.Element, ET.Element],
) -> UINode | None:
    bounds = _parse_bounds(el.get("bounds", ""))
    if not bounds:
        return None
    return UINode(
        text=el.get("text", ""),
        resource_id=el.get("resource-id", ""),
        content_desc=el.get("content-desc", ""),
        cls=el.get("class", ""),
        package=el.get("package", ""),
        bounds=bounds,
        clickable=el.get("clickable", "") == "true",
        depth=depth,
        xpath=_build_xpath(el, parent_map),
        index=int(el.get("index", "0")),
        enabled=el.get("enabled", "") == "true",
        focusable=el.get("focusable", "") == "true",
        scrollable=el.get("scrollable", "") == "true",
        selected=el.get("selected", "") == "true",
        checked=el.get("checked", "") == "true",
        checkable=el.get("checkable", "") == "true",
        focused=el.get("focused", "") == "true",
    )


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


def resolve_click(xml_dump: str, x: int, y: int) -> list[UINode]:
    """All nodes whose bounds contain (x, y), ranked by specificity."""
    root = ET.fromstring(xml_dump)
    parent_map = _build_parent_map(root)
    hits: list[UINode] = []

    def _walk(el: ET.Element, depth: int = 0) -> None:
        node = _el_to_node(el, depth, parent_map)
        if node:
            left, top, right, bottom = node.bounds
            if left <= x <= right and top <= y <= bottom:
                hits.append(node)
        for child in el:
            _walk(child, depth + 1)

    _walk(root)
    hits.sort(key=lambda n: (
        n.is_identifiable and n.clickable,
        n.clickable,
        n.depth,
        n.is_identifiable,
    ), reverse=True)
    return hits


def find_node_by_xpath(xml_dump: str, xpath: str) -> UINode | None:
    """Locate a single node by its recorded xpath."""
    root = ET.fromstring(xml_dump)
    parent_map = _build_parent_map(root)

    parts = xpath.strip("/").split("/")
    if not parts or parts[0] != root.tag:
        return None

    current = root
    for part in parts[1:]:
        m = re.match(r"node\[(\d+)\]", part)
        if not m:
            return None
        idx = int(m.group(1))
        children = list(current)
        if idx >= len(children):
            return None
        current = children[idx]

    return _el_to_node(current, 0, parent_map)


# ---------------------------------------------------------------------------
# Match
# ---------------------------------------------------------------------------


def match_node(recorded: dict[str, Any], live: UINode) -> bool:
    """Check if *live* matches the *recorded* node snapshot.

    Strict: every non-empty recorded attribute must match exactly.
    Rejects featureless nodes to avoid matching generic containers.
    """
    checks = [
        ("class", live.cls),
        ("package", live.package),
        ("resource_id", live.resource_id),
        ("text", live.text),
        ("content_desc", live.content_desc),
    ]
    for key, live_val in checks:
        rec_val = recorded.get(key, "")
        if rec_val and live_val != rec_val:
            return False

    if "index" in recorded and live.index != recorded["index"]:
        return False

    for flag in ("clickable", "enabled", "focusable",
                 "scrollable", "checkable", "checked", "selected",
                 "focused"):
        if flag in recorded and getattr(live, flag) != recorded[flag]:
            return False

    rec_bounds = recorded.get("bounds")
    if rec_bounds and len(rec_bounds) == 4:
        for rb, lb in zip(rec_bounds, live.bounds):
            if abs(rb - lb) > _BOUNDS_TOLERANCE_PX:
                return False

    return True


def find_focused_node(xml_dump: str) -> UINode | None:
    """Return the currently focused node, or ``None``."""
    root = ET.fromstring(xml_dump)
    parent_map = _build_parent_map(root)

    def _walk(el: ET.Element, depth: int = 0) -> UINode | None:
        if el.get("focused", "") == "true":
            node = _el_to_node(el, depth, parent_map)
            if node:
                return node
        for child in el:
            hit = _walk(child, depth + 1)
            if hit:
                return hit
        return None

    return _walk(root)
