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
Scan existing rewrite infrastructure and output infra.json.

Usage:
    python -m report.scan_infra --root data/copilot_collect_rewrite/ --output data/output/infra.json
"""
import argparse
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

# Folders to skip when scanning the rewrite root
SKIP_PATTERNS = {"common", "_", "."}


def _should_skip(name: str) -> bool:
    """Skip common/, date-prefixed folders (0408/), dot/underscore prefixed, non-uppercase."""
    if name in SKIP_PATTERNS or name.startswith(".") or name.startswith("_"):
        return True
    # Date-prefixed folders like 0408, 0412, 0415
    if re.match(r"^\d{4}$", name):
        return True
    # Must start with uppercase letter (feature folders do)
    if not name[0].isupper():
        return True
    return False


def _extract_titles_from_tsv(path: Path) -> list[str]:
    """Read original_test_cases.tsv and return list of titles."""
    titles = []
    try:
        with open(path, encoding="utf-8-sig") as f:
            delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
            reader = csv.DictReader(f, delimiter=delimiter)
            for row in reader:
                title = row.get("Title", "").strip()
                if title:
                    titles.append(title)
    except Exception:
        pass
    return titles


def _extract_rewritten_titles(rewriter_dir: Path) -> list[str]:
    """Extract titles from rewritten_*.csv files."""
    titles = []
    for rf in rewriter_dir.glob("rewritten_*.csv"):
        try:
            with open(rf, encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    title = row.get("Title", "").strip()
                    if title:
                        titles.append(title)
        except Exception:
            pass
    return titles


def _load_feature_doc(doc_path: Path) -> tuple[str, list[str]]:
    """Load Feature_Doc.jsonl and extract excerpt + function list.""""
    try:
        with open(doc_path, encoding="utf-8") as f:
            doc = json.load(f)
            feat = doc.get("feature", {})
            excerpt = feat.get("description", "")[:200]
            functions = list(feat.get("detailed_function_introduction", {}).keys())
            return excerpt, functions
    except Exception:
        return "", []


def scan(root: Path) -> dict:
    """
    Scan the rewrite data root and return structured infra data.

    Returns:
        {
            "scan_root": str,
            "scanned_at": str,
            "features": {
                "Feature_Folder": {
                    "folder": str,
                    "has_original_tsv": bool,
                    "original_case_titles": [str],
                    "has_recorder": bool,
                    "has_parser": bool,
                    "has_feature_doc": bool,
                    "feature_doc_excerpt": str,
                    "feature_doc_functions": [str],
                    "has_rewritten": bool,
                    "rewritten_count": int,
                    "rewritten_titles": [str],
                }, ...
            }
        }
    """
    features = {}

    for d in sorted(root.iterdir()):
        if not d.is_dir() or _should_skip(d.name):
            continue

        info = {"folder": d.name}

        # Original test cases
        orig = d / "original_test_cases.tsv"
        info["has_original_tsv"] = orig.exists()
        info["original_case_titles"] = _extract_titles_from_tsv(orig) if orig.exists() else []

        # Inner folder: <folder>/<folder>/
        inner = d / d.name
        if inner.exists() and inner.is_dir():
            # Recorder — check standard location and alternate patterns:
            #   <inner>/Recorder/          (standard)
            #   <inner>/Recorder_original/ (alternate naming)
            #   <inner>/Parser/Session_*/Recorder/  (session-based structure)
            info["has_recorder"] = False
            for rec_candidate in [inner / "Recorder", inner / "Recorder_original"]:
                if rec_candidate.exists() and (
                    any(rec_candidate.glob("*.mp4"))
                    or any(rec_candidate.glob("input_log_*.txt"))
                ):
                    info["has_recorder"] = True
                    break
            if not info["has_recorder"]:
                # Check session-based structure: Parser/Session_*/Recorder/
                for session_rec in inner.glob("Parser/Session_*/Recorder"):
                    if any(session_rec.glob("*.mp4")) or any(session_rec.glob("input_log_*.txt")):
                        info["has_recorder"] = True
                        break

            # Parser — check standard location and session-based structure:
            #   <inner>/Parser/*_trace.json          (standard)
            #   <inner>/Parser/Session_*/Parser/*_trace.json  (session-based)
            parser = inner / "Parser"
            info["has_parser"] = (
                parser.exists() and any(parser.glob("*_trace.json"))
            )
            if not info["has_parser"] and parser.exists():
                for session_parser in parser.glob("Session_*/Parser"):
                    if any(session_parser.glob("*_trace.json")):
                        info["has_parser"] = True
                        break

            # Rewriter
            rewriter = inner / "Rewriter"
            doc_path = rewriter / "Feature_Doc.jsonl" if rewriter.exists() else None
            info["has_feature_doc"] = doc_path.exists() if doc_path else False

            if info["has_feature_doc"]:
                excerpt, functions = _load_feature_doc(doc_path)
                info["feature_doc_excerpt"] = excerpt
                info["feature_doc_functions"] = functions
            else:
                info["feature_doc_excerpt"] = ""
                info["feature_doc_functions"] = []

            info["has_rewritten"] = (
                rewriter.exists() and any(rewriter.glob("rewritten_*.csv"))
            )
            if info["has_rewritten"]:
                titles = _extract_rewritten_titles(rewriter)
                info["rewritten_count"] = len(titles)
                info["rewritten_titles"] = titles
            else:
                info["rewritten_count"] = 0
                info["rewritten_titles"] = []
        else:
            info["has_recorder"] = False
            info["has_parser"] = False
            info["has_feature_doc"] = False
            info["feature_doc_excerpt"] = ""
            info["feature_doc_functions"] = []
            info["has_rewritten"] = False
            info["rewritten_count"] = 0
            info["rewritten_titles"] = []

        features[d.name] = info

    return {
        "scan_root": str(root),
        "scanned_at": datetime.now().isoformat(timespec="seconds"),
        "features": features,
    }


def main():
    parser = argparse.ArgumentParser(description="Scan rewrite infrastructure")
    parser.add_argument("--root", required=True, help="Rewrite data root folder")
    parser.add_argument("--output", required=True, help="Output infra.json path")
    args = parser.parse_args()

    root = Path(args.root)
    if not root.exists():
        print(f"Error: root folder not found: {root}")
        sys.exit(1)

    result = scan(root)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    n = len(result["features"])
    print(f"Scanned {n} features in {root} → {out_path}")
    for name, info in result["features"].items():
        artifacts = []
        if info["has_recorder"]:
            artifacts.append("Rec")
        if info["has_parser"]:
            artifacts.append("Par")
        if info["has_feature_doc"]:
            artifacts.append("Doc")
        if info["has_rewritten"]:
            artifacts.append(f"Rew({info['rewritten_count']})")
        status = " + ".join(artifacts) if artifacts else "empty"
        print(f"  {name}: {status}")


if __name__ == "__main__":
    main()
