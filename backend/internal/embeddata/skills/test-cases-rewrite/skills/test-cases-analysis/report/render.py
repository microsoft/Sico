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
Unified render entry point for test case analysis reports.

Usage:
    python -m report.render --input analysis.jsonl --type unified --output data/output/
    python -m report.render --input analysis.jsonl --type unified --infra infra.json --output data/output/
    python -m report.render --input analysis.jsonl --type executability --infra infra.json --output data/output/
    python -m report.render --input analysis.jsonl --type prerequisite --output data/output/
    python -m report.render --input analysis.jsonl --type both --infra infra.json --output data/output/
"""
import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Render test case analysis reports from JSONL")
    parser.add_argument("--input", required=True, help="Path to analysis.jsonl")
    parser.add_argument("--type", required=True,
                        choices=["unified", "executability", "prerequisite", "quality", "both", "all"],
                        help="Report type to render. 'unified'=single dashboard with tabs (default for pipeline), "
                             "'both'=executability+prerequisite, 'all'=all types including unified")
    parser.add_argument("--infra", help="Path to infra.json (required for executability)")
    parser.add_argument("--lang", default="en",
                        choices=["en", "cn", "both"],
                        help="Report language: en (default), cn, or both")
    parser.add_argument("--output", required=True, help="Output directory")
    args = parser.parse_args()

    langs = ("en", "cn") if args.lang == "both" else (args.lang,)

    input_path = Path(args.input)
    output_dir = Path(args.output)
    infra_path = Path(args.infra) if args.infra else None

    if not input_path.exists():
        print(f"Error: input file not found: {input_path}")
        sys.exit(1)

    if args.type in ("unified", "all"):
        from .unified.renderer import render as render_unified
        render_unified(input_path, infra_path, output_dir, langs=langs)

    if args.type in ("executability", "both", "all"):
        if not infra_path or not infra_path.exists():
            print(f"Warning: infra.json not found at '{infra_path}'. Executability analysis will treat all features as new.")
        from .breakdown.renderer import render as render_breakdown
        render_breakdown(input_path, infra_path, output_dir, langs=langs)

    if args.type in ("prerequisite", "both", "all"):
        from .requirement.renderer import render as render_requirement
        render_requirement(input_path, output_dir, langs=langs)

    if args.type in ("quality", "all"):
        from .quality.renderer import render as render_quality
        render_quality(input_path, output_dir, langs=langs)

    print(f"\nDone. Output in: {output_dir}")


if __name__ == "__main__":
    main()
