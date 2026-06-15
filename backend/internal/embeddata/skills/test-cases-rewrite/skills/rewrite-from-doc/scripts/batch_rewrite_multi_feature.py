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

"""
Batch rewrite pipeline for multi-feature test case CSVs.

Groups input cases by feature, generates per-feature configs, runs the
rewrite pipeline for each, and merges all outputs into one final CSV.

Usage:
    python scripts/batch_rewrite_multi_feature.py \
        --input data/input/smoke_test.csv \
        --analysis data/output/analysis.jsonl \
        --rewrite-root data/copilot_collect_rewrite \
        --output data/output/smoke_test_rewritten.csv \
        [--model gpt5.4] \
        [--splits SPLITS_JSON]

Requires:
    - analysis.jsonl produced by the test-cases-analysis skill (for case→folder mapping)
    - Rewrite infrastructure under <rewrite-root>/<Feature>/<Feature>/Rewriter/Feature_Doc.jsonl

Split triage:
    Pass --splits as a JSON file or inline JSON to physically split cases.
    Format: {"STCAQA-817": [["Camera", "title...", "1. Step one\\n2. Step two\\n..."], ...], ...}
    Each entry: [label, title, steps]. Steps field contains the complete test steps
    (numbered, newline-separated). If steps is empty or omitted, Title is used as fallback
    (WARNING: this degrades rewrite quality for complex cases).
    If --splits is not provided, all cases pass through without splitting.
"""
import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


# ═══════════════════════════════════════════════════════════════
#  Input reading
# ═══════════════════════════════════════════════════════════════

def read_input_csv(path: Path) -> list[dict]:
    """Read input CSV, handling BOM variants."""
    with open(path, "r", encoding="utf-8-sig") as f:
        text = f.read().lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    # Normalize ID column
    for r in rows:
        if "ID" not in r:
            for k in list(r.keys()):
                if k.endswith("ID"):
                    r["ID"] = r.pop(k)
    return rows


def read_analysis(path: Path) -> dict:
    """Read analysis.jsonl → {case_id: case_record}."""
    case_map = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("type") == "case":
                case_map[rec["case_id"]] = rec
    return case_map


# ═══════════════════════════════════════════════════════════════
#  Split triage
# ═══════════════════════════════════════════════════════════════

def load_splits(splits_arg: str | None) -> dict:
    """Load split definitions from JSON file or inline JSON string."""
    if not splits_arg:
        return {}
    p = Path(splits_arg)
    if p.exists():
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    try:
        return json.loads(splits_arg)
    except json.JSONDecodeError:
        print(f"Warning: Could not parse --splits argument, skipping splits")
        return {}


def apply_splits(rows: list[dict], case_map: dict, splits: dict) -> list[dict]:
    """Expand must-split cases into sub-cases. Returns expanded row list."""
    expanded = []
    title_only_warnings = []
    for row in rows:
        case_id = row.get("ID", "")
        analysis = case_map.get(case_id, {})
        folder = analysis.get("folder", "")
        feature = analysis.get("feature", "")

        if case_id in splits:
            items = splits[case_id]
            for idx, item in enumerate(items, 1):
                label = item[0]
                title = item[1]
                steps = item[2] if len(item) > 2 and item[2] else ""
                if not steps:
                    title_only_warnings.append(f"{case_id}-{idx}")
                new_row = dict(row)
                new_row["ID"] = f"{case_id}-{idx}"
                new_row["Title"] = title
                new_row["_steps"] = steps
                new_row["_original_id"] = case_id
                new_row["_folder"] = folder
                new_row["_feature"] = feature
                if not new_row.get("Platform"):
                    new_row["Platform"] = "Copilot Android"
                if not new_row.get("Project Name"):
                    new_row["Project Name"] = feature
                expanded.append(new_row)
        else:
            row["_original_id"] = case_id
            row["_steps"] = row.get("Steps", "")
            row["_folder"] = folder
            row["_feature"] = feature
            if not row.get("Platform"):
                row["Platform"] = "Copilot Android"
            if not row.get("Project Name"):
                row["Project Name"] = feature
            expanded.append(row)

    if title_only_warnings:
        print(f"  WARNING: {len(title_only_warnings)} sub-cases have no Steps "
              f"(Title-only fallback degrades quality): {', '.join(title_only_warnings[:5])}"
              f"{'...' if len(title_only_warnings) > 5 else ''}")

    return expanded


# ═══════════════════════════════════════════════════════════════
#  Per-feature grouping and CSV writing
# ═══════════════════════════════════════════════════════════════

def group_and_write(expanded: list[dict], work_dir: Path) -> dict:
    """Group by folder, write per-feature input CSVs. Returns {folder: [rows]}."""
    groups = {}
    for row in expanded:
        folder = row.get("_folder", "Unknown")
        groups.setdefault(folder, []).append(row)

    work_dir.mkdir(parents=True, exist_ok=True)
    columns = ["Title", "Description", "Platform", "Project Name", "Steps"]

    for folder, rows in groups.items():
        csv_path = work_dir / f"{folder}_input.csv"
        with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            for r in rows:
                title = r.get("Title", "")
                steps = r.get("_steps", "") or title  # Fallback to Title only if no Steps
                writer.writerow({
                    "Title": title,
                    "Description": title,
                    "Platform": r.get("Platform", ""),
                    "Project Name": r.get("Project Name", ""),
                    "Steps": steps,
                })
        print(f"  {folder}: {len(rows)} cases")

    return groups


# ═══════════════════════════════════════════════════════════════
#  Config generation and pipeline execution
# ═══════════════════════════════════════════════════════════════

def find_feature_doc(rewrite_root: Path, folder: str) -> Path | None:
    """Find Feature_Doc.jsonl for a feature."""
    standard = rewrite_root / folder / folder / "Rewriter" / "Feature_Doc.jsonl"
    if standard.exists():
        return standard
    for p in (rewrite_root / folder).rglob("Feature_Doc.jsonl"):
        return p
    return None


def find_action_space(rewrite_root: Path) -> Path | None:
    """Find shared Action_Space.md."""
    common = rewrite_root / "common" / "Action_Space.md"
    if common.exists():
        return common
    for p in rewrite_root.rglob("Action_Space.md"):
        return p
    return None


def build_cli_args(folder: str, work_dir: Path, rewrite_root: Path,
                   model: str) -> list[str] | None:
    """Build CLI arguments for one feature. Returns arg list or None on failure."""
    doc_path = find_feature_doc(rewrite_root, folder)
    if not doc_path:
        print(f"  WARNING: No Feature_Doc.jsonl for {folder}, skipping")
        return None

    output_dir = work_dir / folder
    output_dir.mkdir(parents=True, exist_ok=True)

    input_csv = work_dir / f"{folder}_input.csv"

    args = [
        sys.executable, "-m", "rewrite_from_doc",
        "--input-csv", str(input_csv.resolve()),
        "--feature-doc", str(doc_path.resolve()),
        "-o", str(output_dir.resolve()),
        "--llmhub-model", model,
    ]

    action_space = find_action_space(rewrite_root)
    if action_space:
        args.extend(["--action-space", str(action_space.resolve())])

    return args


def run_feature(folder: str, cli_args: list[str], index: int, total: int) -> bool:
    """Run rewrite-from-doc for one feature."""
    print(f"\n[{index}/{total}] {folder}")
    start = time.time()
    try:
        result = subprocess.run(
            cli_args,
            cwd=str(PROJECT_ROOT),
            capture_output=True, text=True, timeout=600,
        )
        elapsed = time.time() - start
        if result.returncode == 0:
            lines = (result.stderr or result.stdout or "").split("\n")
            parsed = [l for l in lines if "Parsed" in l and "test" in l]
            info = parsed[0].strip() if parsed else ""
            print(f"  OK ({elapsed:.1f}s) {info}")
            return True
        else:
            print(f"  FAIL ({elapsed:.1f}s, exit {result.returncode})")
            err = (result.stderr or result.stdout or "").strip().split("\n")
            for line in err[-3:]:
                print(f"    {line}")
            return False
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT (>600s)")
        return False
    except Exception as e:
        print(f"  ERROR: {e}")
        return False


# ═══════════════════════════════════════════════════════════════
#  Merge outputs
# ═══════════════════════════════════════════════════════════════

def merge_outputs(groups: dict, expanded: list[dict], work_dir: Path, output_path: Path):
    """Merge per-feature rewritten CSVs into one final CSV."""
    all_results = []
    columns = ["ID", "Original ID", "Title", "Platform", "Project Name",
               "Feature Folder", "Rewritten Steps", "Model Output"]

    for folder in sorted(groups.keys()):
        output_dir = work_dir / folder
        rewritten_csvs = sorted(output_dir.glob("rewritten_*.csv"), reverse=True)

        feature_cases = groups[folder]
        if not rewritten_csvs:
            print(f"  WARNING: No output for {folder}")
            for r in feature_cases:
                all_results.append({
                    "ID": r.get("ID", ""), "Original ID": r.get("_original_id", ""),
                    "Title": r.get("Title", ""), "Platform": r.get("Platform", ""),
                    "Project Name": r.get("Project Name", ""), "Feature Folder": folder,
                    "Rewritten Steps": "[REWRITE FAILED]", "Model Output": "",
                })
            continue

        print(f"  {folder}: {rewritten_csvs[0].name}")
        with open(rewritten_csvs[0], "r", encoding="utf-8-sig") as f:
            rewritten_rows = list(csv.DictReader(f))

        for i, fc in enumerate(feature_cases):
            rr = rewritten_rows[i] if i < len(rewritten_rows) else {}
            all_results.append({
                "ID": fc.get("ID", ""), "Original ID": fc.get("_original_id", ""),
                "Title": fc.get("Title", ""), "Platform": fc.get("Platform", ""),
                "Project Name": fc.get("Project Name", ""), "Feature Folder": folder,
                "Rewritten Steps": rr.get("Rewritten Steps", ""),
                "Model Output": rr.get("Model Output", ""),
            })

    with open(output_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for r in all_results:
            writer.writerow(r)

    print(f"\nFinal: {output_path} ({len(all_results)} rows)")


# ═══════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Batch rewrite multi-feature test cases"
    )
    parser.add_argument("--input", required=True, help="Input test case CSV")
    parser.add_argument("--analysis", required=True, help="analysis.jsonl for feature mapping")
    parser.add_argument("--rewrite-root", required=True, help="Rewrite data root folder")
    parser.add_argument("--output", required=True, help="Output merged rewritten CSV")
    parser.add_argument("--model", default="gpt5.4", help="Model name (default: gpt5.4)")
    parser.add_argument("--splits", default=None,
                        help="JSON file or inline JSON with split definitions")
    args = parser.parse_args()

    input_path = Path(args.input)
    analysis_path = Path(args.analysis)
    rewrite_root = Path(args.rewrite_root)
    output_path = Path(args.output)
    work_dir = output_path.parent / (output_path.stem + "_work")

    print("=" * 60)
    print(f"Batch Rewrite: {input_path.name}")
    print("=" * 60)

    # Step 1: Read
    print("\n--- Read inputs ---")
    rows = read_input_csv(input_path)
    case_map = read_analysis(analysis_path)
    print(f"Input: {len(rows)} cases, Analysis: {len(case_map)} records")

    # Step 2: Split
    splits = load_splits(args.splits)
    expanded = apply_splits(rows, case_map, splits)
    print(f"After splits: {len(expanded)} cases (+{len(expanded) - len(rows)} from {len(splits)} split groups)")

    # Step 3: Group
    print("\n--- Group by feature ---")
    groups = group_and_write(expanded, work_dir)
    print(f"Features: {len(groups)}")

    # Step 4: Run
    print("\n--- Run pipeline ---")
    cli_args_map = {}
    for folder in sorted(groups.keys()):
        args_list = build_cli_args(folder, work_dir, rewrite_root, args.model)
        if args_list:
            cli_args_map[folder] = args_list

    success = failed = 0
    total = len(cli_args_map)
    for i, (folder, cli_args) in enumerate(sorted(cli_args_map.items()), 1):
        ok = run_feature(folder, cli_args, i, total)
        success += ok
        failed += not ok
        if i < total:
            time.sleep(2)

    print(f"\nResults: {success} success, {failed} failed / {total}")

    # Step 5: Merge
    print("\n--- Merge outputs ---")
    merge_outputs(groups, expanded, work_dir, output_path)


if __name__ == "__main__":
    main()
