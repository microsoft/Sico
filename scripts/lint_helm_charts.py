#!/usr/bin/env python3
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
