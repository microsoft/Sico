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

"""Convert Feature_Doc.jsonl to a human-readable Markdown file.

Usage:
    python jsonl_to_md.py <Feature_Doc.jsonl> [-o <output.md>]

If -o is not specified, the output file is written alongside the input
with a .md extension (e.g., Search_Feature_Doc.jsonl → Search_Feature_Doc.md).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _section(title: str, level: int = 2) -> str:
    return f"{'#' * level} {title}\n"


def _bullet(key: str, value: str) -> str:
    return f"- **{key}**: {value}\n"


def _table(headers: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return ""
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(str(c) for c in row) + " |")
    return "\n".join(lines) + "\n"


def convert(doc: dict) -> str:
    """Convert a Feature Doc JSON object to Markdown text."""
    parts: list[str] = []

    # Title
    feature = doc.get("feature", {})
    feature_name = feature.get("name", "Unknown")
    parts.append(f"# Feature Doc: {feature_name}\n")

    # Project section
    project = doc.get("project", {})
    if project:
        parts.append(_section("Project"))
        if project.get("software"):
            parts.append(_bullet("Software", project["software"]))
        if project.get("platform"):
            platforms = project["platform"]
            if isinstance(platforms, list):
                platforms = ", ".join(platforms)
            parts.append(_bullet("Platform", platforms))
        if project.get("app_version"):
            parts.append(_bullet("App Version", project["app_version"]))
        if project.get("description"):
            parts.append(_bullet("Description", project["description"]))
        parts.append("\n")

    # Feature section
    if feature:
        parts.append(_section("Feature"))
        if feature.get("alias"):
            aliases = feature["alias"]
            if isinstance(aliases, list):
                aliases = ", ".join(aliases)
            parts.append(_bullet("Aliases", aliases))
        if feature.get("description"):
            parts.append(f"\n{feature['description']}\n")

        # Sub-features
        funcs = feature.get("detailed_function_introduction", {})
        if funcs and isinstance(funcs, dict):
            parts.append("\n")
            parts.append(_section("Sub-features", level=3))
            rows = [[name, desc] for name, desc in funcs.items()]
            parts.append(_table(["Sub-feature", "Description"], rows))

        # User flow
        user_flow = feature.get("user_flow", [])
        if user_flow:
            parts.append("\n")
            parts.append(_section("User Flow", level=3))
            for step in user_flow:
                parts.append(f"{step}\n")
        parts.append("\n")

    # Navigation Structure
    nav = doc.get("navigation_structure", {})
    if nav:
        parts.append(_section("Navigation Structure"))
        if nav.get("description"):
            parts.append(f"{nav['description']}\n\n")
        pages = nav.get("pages", [])
        for page in pages:
            page_name = page.get("name", "Unknown Page")
            parts.append(_section(page_name, level=3))
            if page.get("note"):
                parts.append(f"*{page['note']}*\n\n")
            elements = page.get("page_elements", {})
            if elements and isinstance(elements, dict):
                rows = [[elem, desc] for elem, desc in elements.items()]
                parts.append(_table(["Element", "Description"], rows))
            children = page.get("children", [])
            if children:
                parts.append("\n**Child pages:**\n")
                for child in children:
                    child_name = child.get("name", "")
                    child_type = child.get("type", "")
                    suffix = f" ({child_type})" if child_type else ""
                    parts.append(f"- {child_name}{suffix}\n")
            parts.append("\n")

    # Starting State
    starting = doc.get("starting_state", {})
    if starting:
        parts.append(_section("Starting State"))
        if starting.get("description"):
            parts.append(f"{starting['description']}\n")
        if starting.get("screenshot"):
            parts.append(f"\n![Starting screenshot]({starting['screenshot']})\n")
        parts.append("\n")

    # Prerequisites
    prereqs = doc.get("prerequisites", {})
    if prereqs:
        parts.append(_section("Prerequisites"))
        env = prereqs.get("environment", [])
        if env:
            parts.append(_section("Environment", level=3))
            for item in env:
                parts.append(f"- {item}\n")
        deps = prereqs.get("dependencies", [])
        if deps:
            parts.append(_section("Dependencies", level=3))
            for item in deps:
                parts.append(f"- {item}\n")
        parts.append("\n")

    # Test Environment Note
    test_env = doc.get("test_environment_note", {})
    if test_env:
        parts.append(_section("Test Environment"))
        if test_env.get("description"):
            parts.append(f"{test_env['description']}\n\n")
        if test_env.get("authentication_guidance"):
            parts.append(_bullet("Authentication Guidance", test_env["authentication_guidance"]))
        examples = test_env.get("examples_requiring_auth", [])
        if examples:
            parts.append("\n**Examples requiring authentication:**\n")
            for ex in examples:
                parts.append(f"- {ex}\n")
        parts.append("\n")

    # Sandbox Auth
    auth = doc.get("sandbox_auth", {})
    if auth and auth.get("description"):
        parts.append(_section("Sandbox Authentication"))
        if auth.get("description"):
            parts.append(f"{auth['description']}\n\n")
        if auth.get("action"):
            parts.append(_bullet("Action", auth["action"]))
        if auth.get("username"):
            parts.append(_bullet("Username", auth["username"]))
        if auth.get("password"):
            parts.append(_bullet("Password", auth["password"]))
        if auth.get("email"):
            parts.append(_bullet("Email", auth["email"]))
        parts.append("\n")

    # Documents
    docs = doc.get("documents", {})
    if docs and any(docs.values()):
        parts.append(_section("Related Documents"))
        for key, val in docs.items():
            if val:
                label = key.replace("_", " ").title()
                parts.append(_bullet(label, val))
        parts.append("\n")

    return "".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert Feature_Doc.jsonl to Markdown",
    )
    parser.add_argument(
        "input", type=Path,
        help="Path to Feature_Doc.jsonl",
    )
    parser.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Output .md path (default: same name with .md extension)",
    )
    args = parser.parse_args(argv)

    if not args.input.exists():
        print(f"Error: input file not found: {args.input}", file=sys.stderr)
        return 1

    try:
        with open(args.input, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON in {args.input}: {e}", file=sys.stderr)
        return 1

    md_text = convert(doc)

    output_path = args.output or args.input.with_suffix(".md")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(md_text)

    print(f"Converted: {args.input} → {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
