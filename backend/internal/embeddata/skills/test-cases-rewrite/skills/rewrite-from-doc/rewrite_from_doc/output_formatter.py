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

"""Output formatter — save rewritten test cases as JSONL and CSV."""

from __future__ import annotations

import csv
import json
import logging
import re
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


def _try_parse_json(text: str) -> dict | None:
    if not text or text == "0":
        return None
    cleaned = re.sub(
        r"^```(?:json)?\s*\n?", "", text.strip(),
    )
    cleaned = re.sub(r"\n?```\s*$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning(
            "Failed to parse JSON from response (length=%d)",
            len(text),
        )
        return None


def _format_steps(parsed: dict | None) -> str:
    if not parsed or not isinstance(parsed, dict):
        return ""
    parts: list[str] = []
    preconditions = parsed.get("preconditions", [])
    if preconditions:
        items = "\n".join(f"    {p}," for p in preconditions)
        parts.append(f"preconditions: [\n{items}\n  ]")
    steps = parsed.get("test_steps", [])
    if steps:
        lines = []
        for s in steps:
            num = s.get("step", "")
            action = s.get("action", "").replace('"', '""')
            lines.append(f"    {num}. {action}")
        items = "\n".join(lines)
        parts.append(f"test_steps: [\n{items}\n  ]")
    postcondition = parsed.get("postcondition", "")
    if postcondition:
        parts.append(f"postcondition: {postcondition}")
    return ",\n  ".join(parts)


def save_jsonl(
    output_dir: Path,
    testcases: list[dict],
    results: list[str],
    prefix: str = "rewritten",
) -> Path:
    """Save as JSONL: one JSON object per line."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{prefix}_{timestamp}.jsonl"
    output_path = output_dir / filename

    with open(output_path, "w", encoding="utf-8") as f:
        for i, tc in enumerate(testcases):
            raw = results[i] if i < len(results) else ""
            parsed = _try_parse_json(raw)
            record = {
                "original": {
                    "title": tc.get("title", ""),
                    "description": tc.get("description", ""),
                    "platform": tc.get("platform", ""),
                    "project_name": tc.get("project_name", ""),
                    "steps": tc.get("steps", ""),
                },
                "rewritten": parsed if parsed else raw,
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    logger.info("Saved JSONL: %s (%d records)", output_path, len(testcases))
    return output_path


def save_csv(
    output_dir: Path,
    input_path: Path,
    testcases: list[dict],
    results: list[str],
    encoding: str = "utf-8",
    prefix: str = "rewritten",
    rewritten_col: str = "Rewritten Steps",
) -> Path:
    """Save as CSV: original columns plus rewritten columns."""
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{prefix}_{input_path.stem}_{timestamp}.csv"
    output_path = output_dir / filename

    if encoding.lower().replace("-", "") == "utf8":
        encoding = "utf-8-sig"

    original_rows: list[dict] = []
    delimiter = (
        "\t" if input_path.suffix.lower() == ".tsv" else ","
    )
    with open(input_path, "r", encoding=encoding, newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        fieldnames = list(reader.fieldnames or [])
        for row in reader:
            original_rows.append(row)

    col_model_output = "Model Output"
    col_steps = rewritten_col
    col_created = "Created At"
    fieldnames.extend([col_model_output, col_steps, col_created])

    created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with open(
        output_path, "w", encoding="utf-8-sig", newline="",
    ) as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, row in enumerate(original_rows):
            raw = results[i] if i < len(results) else ""
            parsed = _try_parse_json(raw)
            row[col_model_output] = raw
            row[col_steps] = _format_steps(parsed)
            row[col_created] = created_at
            writer.writerow(row)

    logger.info("Saved CSV: %s (%d rows)", output_path, len(original_rows))
    return output_path
