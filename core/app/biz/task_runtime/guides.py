from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from app.biz.skill.paths import CURRENT_VERSION_FILE, VERSIONS_DIR, latest_skill_version_dir, skill_cortex_dir

from .workspace.layout import workspace_layout


MAX_SKILL_GUIDE_BYTES = 64 * 1024
MAX_SKILL_RESOURCE_BYTES = 1024 * 1024
MAX_SKILL_CORTEX_BYTES = 4 * 1024 * 1024
_GUIDE_DOCUMENT_NAME = "SKILL.md"
_PROSE_WORKFLOW_MIN_CHARS = 400
_PROJECTED_SKILLS_DIR = ".sico/runs"


class SkillGuideRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    skill_id: int = Field(gt=0)
    version: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class SkillGuideDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: SkillGuideRef
    name: str
    description: str = ""
    guide_path: str


class SkillGuide(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    descriptor: SkillGuideDescriptor
    content: str
    resource_root: str


class SkillGuideRegistry:
    """Discover and resolve bounded guides from authorized skill versions."""

    def __init__(self, workspace_root: Path, *, project_id: int = 0, agent_id: str = "") -> None:
        self._workspace_root = workspace_root
        self._project_id = project_id
        self._agent_id = agent_id

    def list_guides(self) -> tuple[SkillGuideDescriptor, ...]:
        descriptors: list[SkillGuideDescriptor] = []
        for entry in self._read_index():
            descriptor = self._descriptor_for_entry(entry)
            if descriptor is not None:
                descriptors.append(descriptor)
        return tuple(descriptors)

    def resolve(self, ref: SkillGuideRef) -> SkillGuide:
        entry = self._entry_for_skill(ref.skill_id)
        if entry is None:
            raise ValueError(f"skill guide {ref.skill_id} is not authorized in this workspace")
        skill_root = self._skill_root_for_version(ref.skill_id, ref.version)
        descriptor = self._descriptor(entry, skill_root, version=ref.version)
        if descriptor is None:
            raise ValueError(f"skill guide {ref.skill_id} version {ref.version!r} is unavailable")
        if descriptor.ref.content_hash != ref.content_hash:
            raise ValueError(f"skill guide {ref.skill_id} version {ref.version!r} content hash mismatch")
        content, document, _ = _read_guide(skill_root)
        return SkillGuide(descriptor=descriptor, content=content, resource_root=str(document.parent))

    def resolve_name(self, name: str) -> SkillGuide | None:
        normalized = name.strip().lower()
        if not normalized:
            return None
        for descriptor in self.list_guides():
            if descriptor.name.lower() == normalized:
                return self.resolve(descriptor.ref)
        return None

    def activate_explicit(self, user_prompt: str) -> tuple[SkillGuide, ...]:
        guides_by_name = {descriptor.name.lower(): descriptor for descriptor in self.list_guides()}
        activated: list[SkillGuide] = []
        seen: set[SkillGuideRef] = set()
        for token in user_prompt.lstrip().split():
            if not token.startswith("/") or len(token) == 1:
                break
            descriptor = guides_by_name.get(token[1:].rstrip(",:").lower())
            if descriptor is None or descriptor.ref in seen:
                break
            seen.add(descriptor.ref)
            activated.append(self.resolve(descriptor.ref))
        return tuple(activated)

    def _descriptor_for_entry(self, entry: dict[str, object]) -> SkillGuideDescriptor | None:
        skill_id = _skill_id(entry)
        if skill_id <= 0:
            return None
        skill_root = self._current_skill_root(skill_id)
        return self._descriptor(entry, skill_root, version=self._version_for_root(skill_root))

    def _descriptor(
        self,
        entry: dict[str, object],
        skill_root: Path,
        *,
        version: str,
    ) -> SkillGuideDescriptor | None:
        try:
            content, document, content_hash = _read_guide(skill_root)
        except (OSError, UnicodeError, ValueError):
            return None
        if len(content.strip()) < _PROSE_WORKFLOW_MIN_CHARS:
            return None
        skill_id = _skill_id(entry)
        return SkillGuideDescriptor(
            ref=SkillGuideRef(skill_id=skill_id, version=version or f"snapshot-{content_hash}", content_hash=content_hash),
            name=str(entry.get("name") or f"skill-{skill_id}").strip() or f"skill-{skill_id}",
            description=str(entry.get("description") or ""),
            guide_path=f"skills/{skill_id}/SKILL.md",
        )

    def _entry_for_skill(self, skill_id: int) -> dict[str, object] | None:
        return next((entry for entry in self._read_index() if _skill_id(entry) == skill_id), None)

    def _read_index(self) -> list[dict[str, object]]:
        path = self._workspace_root / "skills" / "index.json"
        if not path.is_file():
            return []
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, list):
            return []
        return [entry for entry in loaded if isinstance(entry, dict)]

    def _skill_base(self, skill_id: int) -> Path:
        if self._project_id or self._agent_id:
            for _, _, root in workspace_layout().skill_roots(project_id=self._project_id, agent_id=self._agent_id):
                skill_base = root / str(skill_id)
                if skill_base.is_dir():
                    return skill_base
        return self._workspace_root.parent / "skills" / str(skill_id)

    def _current_skill_root(self, skill_id: int) -> Path:
        return latest_skill_version_dir(self._skill_base(skill_id))

    def _skill_root_for_version(self, skill_id: int, version: str) -> Path:
        skill_base = self._skill_base(skill_id)
        version_root = skill_base / VERSIONS_DIR / version
        if (skill_base / VERSIONS_DIR).is_dir():
            return version_root
        return latest_skill_version_dir(skill_base)

    @staticmethod
    def _version_for_root(skill_root: Path) -> str:
        if skill_root.parent.name == VERSIONS_DIR:
            return skill_root.name
        current_version = skill_root / CURRENT_VERSION_FILE
        if current_version.is_file():
            return current_version.read_text(encoding="utf-8").strip()
        return ""


def render_activated_guides(guides: tuple[SkillGuide, ...]) -> str:
    sections: list[str] = []
    for guide in guides:
        descriptor = guide.descriptor
        sections.append(
            "\n".join(
                (
                    f'<activated_skill name="{descriptor.name}" skill_id="{descriptor.ref.skill_id}" '
                    f'version="{descriptor.ref.version}" content_hash="{descriptor.ref.content_hash}">',
                    guide.content.strip(),
                    "Use instruction/cortex resources only; do not reconstruct a guide script call.",
                    f"Base directory for this skill: {guide.resource_root}",
                    "</activated_skill>",
                )
            )
        )
    return "\n\n".join(sections)


def render_guide_catalogue(descriptors: tuple[SkillGuideDescriptor, ...]) -> str:
    if not descriptors:
        return ""
    lines = [
        "These instruction skill guides are available:",
        "- Start a request with /<skill_name> to activate an exact guide before the agent acts.",
        "- Guide activation supplies instructions only; executable operations remain separate capability actions.",
    ]
    for descriptor in descriptors:
        lines.append(f"- skill_id: {descriptor.ref.skill_id}")
        lines.append(f"  skill_name: {descriptor.name}")
        if descriptor.description:
            lines.append(f"  description: {descriptor.description}")
        lines.append("  kind: instruction_guide")
        lines.append(f"  version: {descriptor.ref.version}")
        lines.append(f"  content_hash: {descriptor.ref.content_hash}")
    return "\n".join(lines)


def build_skill_prompt_section(
    catalogue_section: str,
    registry: SkillGuideRegistry,
    activated: tuple[SkillGuide, ...],
) -> tuple[str, tuple[SkillGuideRef, ...]]:
    section = "\n\n".join(
        value
        for value in (catalogue_section, render_guide_catalogue(registry.list_guides()), render_activated_guides(activated))
        if value
    )
    return section, tuple(guide.descriptor.ref for guide in activated)


def project_guides_into_workspace(
    guides: tuple[SkillGuide, ...],
    workspace: Path,
    run_id: str,
) -> tuple[SkillGuide, ...]:
    """Publish activated cortex files under one immutable run-scoped workspace path."""
    if not run_id or Path(run_id).name != run_id:
        raise ValueError("run ID is not safe for skill projection")
    workspace = workspace.resolve()
    projection_root = workspace / _PROJECTED_SKILLS_DIR / run_id / "skills"
    projected: list[SkillGuide] = []
    for guide in guides:
        ref = guide.descriptor.ref
        source = Path(guide.resource_root).resolve()
        files, source_hash = _cortex_files(source)
        destination = projection_root / str(ref.skill_id) / ref.version
        if destination.exists():
            _, destination_hash = _cortex_files(destination)
            if destination_hash != source_hash:
                raise ValueError(f"projected skill guide {ref.skill_id} version {ref.version!r} is inconsistent")
        else:
            _publish_cortex(files, source, destination)
        guide_document = destination / _GUIDE_DOCUMENT_NAME
        if hashlib.sha256(guide_document.read_bytes()).hexdigest() != ref.content_hash:
            raise ValueError(f"projected skill guide {ref.skill_id} version {ref.version!r} content hash mismatch")
        projected.append(
            guide.model_copy(update={"resource_root": destination.relative_to(workspace).as_posix()})
        )
    return tuple(projected)


def _cortex_files(root: Path) -> tuple[tuple[Path, ...], str]:
    if not root.is_dir():
        raise ValueError(f"skill cortex is unavailable: {root}")
    files: list[Path] = []
    total_bytes = 0
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"skill cortex contains a symbolic link: {path.relative_to(root).as_posix()}")
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        size = path.stat().st_size
        if size > MAX_SKILL_RESOURCE_BYTES:
            raise ValueError(f"skill resource exceeds {MAX_SKILL_RESOURCE_BYTES} bytes: {relative.as_posix()}")
        total_bytes += size
        if total_bytes > MAX_SKILL_CORTEX_BYTES:
            raise ValueError(f"skill cortex exceeds {MAX_SKILL_CORTEX_BYTES} bytes")
        content_hash = hashlib.sha256(path.read_bytes()).digest()
        digest.update(relative.as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(content_hash)
        files.append(path)
    if not any(path.relative_to(root).as_posix() == _GUIDE_DOCUMENT_NAME for path in files):
        raise ValueError("skill cortex does not contain SKILL.md")
    return tuple(files), digest.hexdigest()


def _publish_cortex(files: tuple[Path, ...], source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.tmp"
    try:
        temporary.mkdir()
        for path in files:
            target = temporary / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        try:
            os.replace(temporary, destination)
        except FileExistsError:
            if not destination.is_dir():
                raise
    except OSError as exc:
        raise ValueError(f"skill cortex projection failed: {exc}") from exc
    finally:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)


def _read_guide(skill_root: Path) -> tuple[str, Path, str]:
    document = skill_cortex_dir(skill_root) / _GUIDE_DOCUMENT_NAME
    size = document.stat().st_size
    if size > MAX_SKILL_GUIDE_BYTES:
        raise ValueError(f"skill guide exceeds {MAX_SKILL_GUIDE_BYTES} bytes")
    content_bytes = document.read_bytes()
    return content_bytes.decode("utf-8"), document, hashlib.sha256(content_bytes).hexdigest()


def _skill_id(entry: dict[str, object]) -> int:
    try:
        return int(entry.get("id") or 0)
    except (TypeError, ValueError):
        return 0
