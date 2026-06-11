"""
Load and parse analysis.jsonl (the intermediate document produced by LLM).
Shared by both breakdown and requirement renderers.
"""
import json
from pathlib import Path
from typing import Optional


def load_analysis(path: Path) -> dict:
    """
    Parse analysis.jsonl into structured data.

    Returns:
        {
            "meta": {...},
            "cases": [case_record, ...],
            "feature_summaries": {"Feature Name": summary_record, ...},
        }
    """
    meta = {}
    cases = []
    feature_summaries = {}

    with open(path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"Warning: invalid JSON at line {line_num}: {e}")
                continue

            rtype = record.get("type", "")
            if rtype == "meta":
                meta = record
            elif rtype == "case":
                cases.append(record)
            elif rtype == "feature_summary":
                feature_summaries[record["feature"]] = record
            else:
                print(f"Warning: unknown record type '{rtype}' at line {line_num}")

    return {
        "meta": meta,
        "cases": cases,
        "feature_summaries": feature_summaries,
    }


def load_infra(path: Optional[Path]) -> dict:
    """Load infra.json. Returns empty dict if path is None or missing."""
    if path is None or not path.exists():
        return {"features": {}}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def group_cases_by_feature(cases: list) -> dict:
    """Group case records by feature name. Returns {feature: [cases]}."""
    groups = {}
    for c in cases:
        feat = c.get("feature", "Other")
        groups.setdefault(feat, []).append(c)
    return groups
