#!/usr/bin/env python3
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

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHART_DIRS = [
    REPO_ROOT / "backend" / "deployments" / "helm",
    REPO_ROOT / "core" / "deployments" / "helm",
]


def main() -> int:
    helm = shutil.which("helm")
    if helm is None:
        if os.environ.get("CI") or os.environ.get("GITHUB_ACTIONS"):
            print(
                "helm is required for Helm chart validation in CI. Install it before running pre-commit.",
                file=sys.stderr,
            )
            return 1

        print(
            "Skipping Helm chart validation because helm is not installed locally. Install it with `make setup-kind` when working on Kind or Helm charts.",
            file=sys.stderr,
        )
        return 0

    failed = False
    for chart_dir in CHART_DIRS:
        if not (chart_dir / "Chart.yaml").exists():
            continue

        relative_chart_dir = chart_dir.relative_to(REPO_ROOT)
        print(f"==> helm lint {relative_chart_dir}")
        result = subprocess.run([helm, "lint", str(chart_dir)], cwd=REPO_ROOT, check=False)
        if result.returncode != 0:
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
