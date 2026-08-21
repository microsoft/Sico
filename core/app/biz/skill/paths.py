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
