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

from pathlib import Path


ORIGINAL_DIR = "original"
RESOLVED_CORTEX_DIR = "resolved/cortex"
RESOLVED_DIR = "resolved"
VERSIONS_DIR = "versions"
CURRENT_VERSION_FILE = "current_version.txt"


def latest_skill_version_dir(skill_dir: Path) -> Path:
    current_version_file = skill_dir / CURRENT_VERSION_FILE
    if not current_version_file.is_file():
        return skill_dir
    current_version = current_version_file.read_text(encoding="utf-8").strip()
    if not current_version:
        return skill_dir
    version_dir = skill_dir / VERSIONS_DIR / current_version
    return version_dir if version_dir.is_dir() else skill_dir


def skill_cortex_dir(skill_dir: Path) -> Path:
    version_dir = latest_skill_version_dir(skill_dir)
    cortex_dir = version_dir / RESOLVED_CORTEX_DIR
    if cortex_dir.is_dir():
        return cortex_dir
    original_dir = version_dir / ORIGINAL_DIR
    if original_dir.is_dir():
        return original_dir
    return version_dir


def skill_runtime_dir(skill_dir: Path) -> Path:
    runtime_dir = skill_dir / "runtime"
    if runtime_dir.is_dir():
        return runtime_dir
    original_dir = skill_dir / ORIGINAL_DIR
    if original_dir.is_dir():
        return original_dir
    return skill_dir
