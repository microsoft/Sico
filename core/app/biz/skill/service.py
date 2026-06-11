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

import asyncio
import io
import json
import logging
import os
import shutil
import zipfile
from pathlib import Path, PurePosixPath

import requests

from app.biz.skill.resolver import (
    ORIGINAL_DIR,
    RESOLVED_ACTIONS_FILE,
    RESOLVED_CORTEX_DIR,
    RESOLVED_DIR,
    RESOLVED_STATUS_FILE,
    ResolvedActionsManifest,
    SkillResolver,
    SkillResolverDiagnostics,
    build_actions_manifest,
    build_fallback_resolved_skill,
    build_update_context,
    validate_resolved_skill,
)
from app.pb.skill.skill import (
    DeleteSkillFromFsRequest,
    DeleteSkillFromFsResponse,
    ExtractSkillRequest,
    ExtractSkillResponse,
    GetSkillDetailsGrpcRequest,
    GetSkillDetailsGrpcResponse,
    SkillAction,
    SkillFile,
    SkillServiceBase,
    SkillVersion,
    WriteSkillVersionRequest,
    WriteSkillVersionResponse,
)
from app.storage.fs import SKILLS_FS, parse_skill_frontmatter
from app.utils.uploads import post_file
from app.utils.response import failed_response, success_response

_LOGGER = logging.getLogger(__name__)

def _write_skill_version_validation_error(message: WriteSkillVersionRequest) -> str:
    if not message.project_id and not message.agent_id:
        return "one of project_id or agent_id is required"
    if message.project_id and message.agent_id:
        return "only one of project_id or agent_id should be provided"
    if not message.version.strip():
        return "version is required"
    if not message.source_version.strip():
        return "source_version is required"
    if not message.asset_id and not message.files and not message.actions:
        return "asset_id, files, or actions are required"
    return ""


class SkillService(SkillServiceBase):
    """gRPC service for skill extraction and details retrieval."""

    async def extract_skill(self, message: ExtractSkillRequest) -> ExtractSkillResponse:  # type: ignore[override]
        _LOGGER.info(
            "ExtractSkill request received: skill_id=%s version=%s project_id=%s agent_id=%s",
            message.skill_id,
            message.version,
            message.project_id,
            message.agent_id,
        )

        # Validate exactly one scope ID
        if not message.project_id and not message.agent_id:
            return failed_response(ExtractSkillResponse(message="one of project_id or agent_id is required"))
        if message.project_id and message.agent_id:
            return failed_response(ExtractSkillResponse(message="only one of project_id or agent_id should be provided"))
        version = message.version.strip()
        if not version:
            return failed_response(ExtractSkillResponse(message="version is required"))

        file_url = (message.download_url or "").strip()
        if not file_url:
            _LOGGER.warning("No download URL provided; cannot extract skill skill_id=%s", message.skill_id)
            return failed_response(ExtractSkillResponse(message="missing download url"))

        try:
            name, description, skill_root = await asyncio.to_thread(
                self._download_and_extract, message.skill_id, message.project_id, message.agent_id, version, file_url
            )
            await self._resolve_and_write(skill_root)
            self._set_current_skill_version(message.skill_id, message.project_id, message.agent_id, version)
            resolved_skill_md = skill_root / RESOLVED_CORTEX_DIR / "SKILL.md"
            if resolved_skill_md.exists():
                resolved_metadata = parse_skill_frontmatter(resolved_skill_md.read_text(encoding="utf-8"))
                name = resolved_metadata.get("name", name)
                description = resolved_metadata.get("description", description)
            _LOGGER.info("Skill extraction succeeded skill_id=%s name=%s", message.skill_id, name)
        except Exception as exc:
            _LOGGER.error("Skill extraction failed skill_id=%s error=%s", message.skill_id, exc)
            return failed_response(ExtractSkillResponse(message=str(exc)))

        return success_response(
            ExtractSkillResponse(
                message="received",
                name=name,
                description=description,
            )
        )

    async def get_skill_details(self, message: GetSkillDetailsGrpcRequest) -> GetSkillDetailsGrpcResponse:  # type: ignore[override]
        _LOGGER.info(
            "GetSkillDetails request received skill_id=%s project_id=%s agent_id=%s versions=%s",
            message.skill_id,
            message.project_id,
            message.agent_id,
            list(message.versions),
        )

        requested_versions = [version.strip() for version in message.versions if version.strip()]
        if not requested_versions:
            return failed_response(GetSkillDetailsGrpcResponse(msg="versions is required"))
        if not message.project_id and not message.agent_id:
            return failed_response(GetSkillDetailsGrpcResponse(msg="one of project_id or agent_id is required"))
        if message.project_id and message.agent_id:
            return failed_response(GetSkillDetailsGrpcResponse(msg="only one of project_id or agent_id should be provided"))

        try:
            files = await asyncio.to_thread(
                self._read_current_skill_version,
                message.skill_id,
                message.project_id,
                message.agent_id,
                requested_versions,
            )
            version, versions = files
            return success_response(GetSkillDetailsGrpcResponse(version=version, versions=versions))
        except Exception as exc:
            _LOGGER.error("GetSkillDetails failed skill_id=%s error=%s", message.skill_id, exc)
            return failed_response(GetSkillDetailsGrpcResponse(msg=str(exc)))

    async def write_skill_version(self, message: WriteSkillVersionRequest) -> WriteSkillVersionResponse:  # type: ignore[override]
        _LOGGER.info(
            "WriteSkillVersion request received: skill_id=%s version=%s project_id=%s agent_id=%s",
            message.skill_id,
            message.version,
            message.project_id,
            message.agent_id,
        )

        validation_error = _write_skill_version_validation_error(message)
        if validation_error:
            return failed_response(WriteSkillVersionResponse(), msg=validation_error)

        try:
            is_asset_update = bool(message.asset_id and not message.files and not message.actions)
            skill_root = await asyncio.to_thread(
                self._write_skill_version,
                message.skill_id,
                message.project_id,
                message.agent_id,
                message.version.strip(),
                message.source_version.strip(),
                message.asset_id,
                message.download_url.strip(),
                message.files,
                message.actions,
            )
            asset_id = message.asset_id
            if (is_asset_update or message.files) and not message.actions:
                previous_version_base = self._skill_version_base(
                    message.skill_id,
                    message.project_id,
                    message.agent_id,
                    message.source_version.strip(),
                )
                previous_original_root = previous_version_base / ORIGINAL_DIR
                has_diff = await asyncio.to_thread(
                    _has_original_diff,
                    previous_original_root,
                    skill_root / ORIGINAL_DIR,
                )
                if has_diff:
                    await self._resolve_and_write(
                        skill_root,
                        previous_original_root=previous_original_root,
                        previous_actions_file=previous_version_base / RESOLVED_ACTIONS_FILE,
                    )
                else:
                    copied = await asyncio.to_thread(_copy_previous_resolved, previous_version_base, skill_root)
                    _LOGGER.info(
                        "WriteSkillVersion original has no diff; skill_id=%s version=%s source_version=%s "
                        "reused_previous_resolved=%s",
                        message.skill_id,
                        message.version,
                        message.source_version,
                        copied,
                    )
                    if not copied:
                        _LOGGER.info(
                            "WriteSkillVersion previous resolved output unavailable; resolving skill_id=%s version=%s "
                            "source_version=%s",
                            message.skill_id,
                            message.version,
                            message.source_version,
                        )
                        await self._resolve_and_write(
                            skill_root,
                            previous_original_root=previous_original_root,
                            previous_actions_file=previous_version_base / RESOLVED_ACTIONS_FILE,
                        )
            if message.files:
                asset_id = await asyncio.to_thread(
                    self._upload_original_skill_asset,
                    message.skill_id,
                    message.project_id,
                    message.version.strip(),
                    skill_root,
                )
            name, description = await asyncio.to_thread(
                self._finalize_skill_version,
                message.skill_id,
                message.project_id,
                message.agent_id,
                message.version.strip(),
            )
            return success_response(WriteSkillVersionResponse(name=name, description=description, asset_id=asset_id))
        except Exception as exc:
            _LOGGER.error("WriteSkillVersion failed skill_id=%s version=%s error=%s", message.skill_id, message.version, exc)
            return failed_response(WriteSkillVersionResponse(msg=str(exc)))

    async def delete_skill_from_fs(self, message: DeleteSkillFromFsRequest) -> DeleteSkillFromFsResponse:  # type: ignore[override]
        _LOGGER.info(
            "DeleteSkillFromFS request received: skill_id=%s project_id=%s agent_id=%s",
            message.skill_id,
            message.project_id,
            message.agent_id,
        )

        if not message.project_id and not message.agent_id:
            return failed_response(DeleteSkillFromFsResponse(msg="one of project_id or agent_id is required"))
        if message.project_id and message.agent_id:
            return failed_response(DeleteSkillFromFsResponse(msg="only one of project_id or agent_id should be provided"))

        try:
            await asyncio.to_thread(
                SKILLS_FS.delete_resource,
                message.skill_id,
                project_id=message.project_id,
                agent_id=message.agent_id,
            )
            _LOGGER.info("Skill deleted from FS skill_id=%s", message.skill_id)
        except FileNotFoundError:
            _LOGGER.info("Skill not found in FS skill_id=%s, ignoring", message.skill_id)
        except Exception as exc:
            _LOGGER.error("DeleteSkillFromFS failed skill_id=%s error=%s", message.skill_id, exc)
            return failed_response(DeleteSkillFromFsResponse(msg=str(exc)))

        return success_response(DeleteSkillFromFsResponse())

    def _download_and_extract(
        self,
        skill_id: int,
        project_id: int,
        agent_id: str,
        version: str,
        file_url: str,
    ) -> tuple[str, str, Path]:
        """Download the skill archive and extract it to the skill filesystem.

        Supports two upload formats:
        - A zip archive containing skill files (optionally nested under a single
          top-level directory which will be stripped).
        - A plain SKILL.md file.

        Returns (name, description, skill_root) parsed from original/SKILL.md.
        Raises ValueError if SKILL.md is missing or name/description are empty.
        """
        _LOGGER.info("Downloading skill file from %s", file_url)
        resp = requests.get(file_url, timeout=120)
        resp.raise_for_status()

        raw = resp.content
        buf = io.BytesIO(raw)

        if zipfile.is_zipfile(buf):
            self._extract_zip(buf, skill_id, project_id, agent_id, version)
        else:
            # Interpret as a plain SKILL.md text file.
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                raise ValueError("uploaded file is not a valid zip archive or SKILL.md")

            skill_root = self._prepare_skill_version_dir(skill_id, project_id, agent_id, version)
            skill_md = skill_root / ORIGINAL_DIR / "SKILL.md"
            skill_md.parent.mkdir(parents=True, exist_ok=True)
            skill_md.write_text(text, encoding="utf-8")

        skill_root = self._skill_version_base(skill_id, project_id, agent_id, version)
        skill_md_content = (skill_root / ORIGINAL_DIR / "SKILL.md").read_text(encoding="utf-8")
        metadata = parse_skill_frontmatter(skill_md_content)
        name = metadata.get("name", "")
        description = metadata.get("description", "")
        if not name or not description:
            raise ValueError("SKILL.md must contain non-empty name and description")
        return name, description, skill_root

    @staticmethod
    def _clear_skill_dir(skill_id: int, project_id: int, agent_id: str) -> None:
        SKILLS_FS.delete_resource(skill_id, project_id=project_id, agent_id=agent_id)

    def _skill_base(self, skill_id: int, project_id: int, agent_id: str):
        if project_id:
            return SKILLS_FS._root / "project" / str(project_id) / SKILLS_FS._resource_dir / str(skill_id)
        return SKILLS_FS._root / "agent" / str(agent_id) / SKILLS_FS._resource_dir / str(skill_id)

    def _skill_version_base(self, skill_id: int, project_id: int, agent_id: str, version: str) -> Path:
        return self._skill_base(skill_id, project_id, agent_id) / "versions" / version

    def _prepare_skill_version_dir(self, skill_id: int, project_id: int, agent_id: str, version: str) -> Path:
        version_base = self._skill_version_base(skill_id, project_id, agent_id, version)
        if version_base.exists():
            shutil.rmtree(version_base)
        version_base.mkdir(parents=True, exist_ok=True)
        return version_base

    def _set_current_skill_version(self, skill_id: int, project_id: int, agent_id: str, version: str) -> None:
        base = self._skill_base(skill_id, project_id, agent_id)
        base.mkdir(parents=True, exist_ok=True)
        (base / "current_version.txt").write_text(version, encoding="utf-8")

    def _current_skill_base(self, skill_id: int, project_id: int, agent_id: str) -> tuple[Path, str]:
        base = self._skill_base(skill_id, project_id, agent_id)
        current_version_file = base / "current_version.txt"
        current_version = current_version_file.read_text(encoding="utf-8").strip() if current_version_file.exists() else ""
        version_base = base / "versions" / current_version if current_version else base
        return (version_base if version_base.exists() else base), current_version

    @staticmethod
    def _detect_top_level_dir(names: list[str]) -> str:
        """Return the common top-level directory if all entries share one, else ''."""
        normalized_names = [_safe_zip_stored_name(name, "") for name in names]
        normalized_names = [name for name in normalized_names if name]
        if not normalized_names:
            return ""
        parts = [name.split("/", 1) for name in normalized_names]
        # Every entry must have at least one '/' and share the same first segment
        first_segments = {p[0] for p in parts if len(p) == 2}
        standalone = [p[0] for p in parts if len(p) == 1]
        if len(first_segments) == 1 and not standalone:
            return first_segments.pop() + "/"
        return ""

    def _extract_zip(
        self,
        buf: io.BytesIO,
        skill_id: int,
        project_id: int,
        agent_id: str,
        version: str,
    ) -> None:
        """Extract a zip archive into the skill filesystem.

        If all files share a single top-level directory, that prefix is stripped
        so files are stored directly under the skill directory.
        Raises ValueError if no SKILL.md is found in the archive.
        """
        buf.seek(0)
        with zipfile.ZipFile(buf, "r") as zf:
            file_entries = [
                info
                for info in zf.infolist()
                if not info.is_dir()
                and not info.filename.startswith("__MACOSX/")
                and not info.filename.endswith("/.DS_Store")
                and info.filename != ".DS_Store"
                and not _is_pycache_path(info.filename)
            ]
            raw_names = [info.filename for info in file_entries]

            # Detect and strip common top-level directory
            prefix = self._detect_top_level_dir(raw_names)

            stored_entries: list[tuple[zipfile.ZipInfo, str]] = []
            for info in file_entries:
                stored_name = _safe_zip_stored_name(info.filename, prefix)
                if not stored_name:
                    continue
                stored_entries.append((info, stored_name))

            if not any(stored_name == "SKILL.md" for _info, stored_name in stored_entries):
                raise ValueError("SKILL.md is required but not found in the uploaded archive")

            skill_root = self._prepare_skill_version_dir(skill_id, project_id, agent_id, version)
            for info, stored_name in stored_entries:
                name = info.filename
                content = zf.read(name).decode("utf-8", errors="replace")
                target = skill_root / ORIGINAL_DIR / stored_name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")

    def _read_current_skill_version(
        self,
        skill_id: int,
        project_id: int,
        agent_id: str,
        requested_versions: list[str],
    ) -> tuple[SkillVersion, list[SkillVersion]]:
        base, current_version = self._current_skill_base(skill_id, project_id, agent_id)
        actions = self._read_skill_actions_from_base(base)
        version = SkillVersion(skill_id=skill_id, version=current_version, actions=actions)
        return version, self._list_skill_versions(skill_id, project_id, agent_id, version, requested_versions)

    def _read_skill_actions_from_base(self, base: Path) -> list[SkillAction]:
        from app.biz.skill.resolver import load_resolved_actions

        actions: list[SkillAction] = []
        for action in load_resolved_actions(base):
            payload = action.model_dump(mode="json")
            name = str(payload.pop("name", ""))
            description = str(payload.pop("description", ""))
            actions.append(
                SkillAction(
                    name=name,
                    description=description,
                    advanced_settings=json.dumps(payload, ensure_ascii=False, indent=2),
                )
            )
        return actions

    def _list_skill_versions(
        self,
        skill_id: int,
        project_id: int,
        agent_id: str,
        current: SkillVersion,
        requested_versions: list[str],
    ) -> list[SkillVersion]:
        base = self._skill_base(skill_id, project_id, agent_id)
        versions_root = base / "versions"
        if not versions_root.is_dir():
            return [current] if current.version else []
        versions = []
        seen = set()
        version_paths = []
        for version in requested_versions:
            version = version.strip()
            if not version or version in seen:
                continue
            seen.add(version)
            path = versions_root / version
            if path.is_dir():
                version_paths.append(path)
        for path in version_paths:
            if current.version and path.name == current.version:
                versions.append(current)
                continue
            versions.append(
                SkillVersion(
                    skill_id=skill_id,
                    version=path.name,
                    actions=self._read_skill_actions_from_base(path),
                )
            )
        return versions

    def _write_skill_version(  # noqa: PLR0913 - mirrors WriteSkillVersionRequest fields without an extra wrapper.
        self,
        skill_id: int,
        project_id: int,
        agent_id: str,
        version: str,
        source_version: str,
        asset_id: int,
        download_url: str,
        files: list[SkillFile],
        actions: list[SkillAction],
    ) -> Path:
        if asset_id and not files and not actions:
            if not download_url:
                raise ValueError("download_url is required for asset skill updates")
            _name, _description, skill_root = self._download_and_extract(
                skill_id,
                project_id,
                agent_id,
                version,
                download_url,
            )
            return skill_root

        base = self._skill_base(skill_id, project_id, agent_id)
        version_base = base / "versions" / version
        if version_base.exists():
            shutil.rmtree(version_base)
        version_base.mkdir(parents=True, exist_ok=True)

        if files:
            original_root = version_base / ORIGINAL_DIR
            source_base = self._skill_version_base(skill_id, project_id, agent_id, source_version)
            source_original_root = source_base / ORIGINAL_DIR
            if not source_version or not source_original_root.is_dir():
                raise ValueError("source_version is required for file skill updates")
            shutil.copytree(source_original_root, original_root, dirs_exist_ok=True)
            for file in files:
                if _is_pycache_path(file.path):
                    continue
                target = _safe_child_path(original_root, file.path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(file.content, encoding="utf-8")
        else:
            source_base = self._skill_version_base(skill_id, project_id, agent_id, source_version)
            if not source_version or not source_base.is_dir():
                raise ValueError("source_version is required for action-only skill updates")
            shutil.copytree(source_base, version_base, dirs_exist_ok=True)

        if actions:
            manifest = ResolvedActionsManifest.from_pb(actions)
            self._write_json(version_base / RESOLVED_ACTIONS_FILE, manifest.model_dump())
        if not (version_base / ORIGINAL_DIR / "SKILL.md").exists():
            raise ValueError("SKILL.md is required")
        return version_base

    def _finalize_skill_version(self, skill_id: int, project_id: int, agent_id: str, version: str) -> tuple[str, str]:
        version_base = self._skill_version_base(skill_id, project_id, agent_id, version)
        skill_md = version_base / RESOLVED_CORTEX_DIR / "SKILL.md"
        if not skill_md.exists():
            skill_md = version_base / ORIGINAL_DIR / "SKILL.md"
        if not skill_md.exists():
            raise ValueError("SKILL.md is required")
        metadata = parse_skill_frontmatter(skill_md.read_text(encoding="utf-8"))
        name = metadata.get("name", "")
        description = metadata.get("description", "")
        if not name or not description:
            raise ValueError("SKILL.md must contain non-empty name and description")
        self._set_current_skill_version(skill_id, project_id, agent_id, version)
        return name, description

    def _upload_original_skill_asset(self, skill_id: int, project_id: int, version: str, skill_root: Path) -> tuple[int, str]:
        endpoint = os.getenv("SICO_ENDPOINT", "").strip().rstrip("/")
        if not endpoint:
            raise ValueError("SICO_ENDPOINT is required to upload updated skill assets")
        app_name = os.getenv("SICO_APP_NAME", "sico").strip() or "sico"
        data = _zip_original_skill(skill_root)
        file_name = f"skill-{skill_id}-{version}.zip"
        response = post_file(
            f"{endpoint}/api/{app_name}/project/asset",
            file_name=file_name,
            data=data,
            content_type="application/zip",
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        asset_id = int(payload.get("data", {}).get("id") or 0)
        if asset_id <= 0:
            raise ValueError("skill asset upload did not return an asset id")
        return asset_id

    async def _resolve_and_write(
        self,
        skill_root: Path,
        *,
        previous_original_root: Path | None = None,
        previous_actions_file: Path | None = None,
    ) -> None:
        original_root = skill_root / ORIGINAL_DIR
        resolved = None
        try:
            resolved = await SkillResolver().resolve(
                original_root,
                previous_original_root=previous_original_root,
                previous_actions_file=previous_actions_file,
            )
            validate_resolved_skill(resolved, original_root)
            self._write_resolved(skill_root, resolved)
            diagnostics = SkillResolverDiagnostics(status="resolved")
        except Exception as exc:  # noqa: BLE001
            model_return = resolved.model_dump_json(indent=2) if resolved is not None else "<no model return>"
            _LOGGER.warning(
                "SkillResolver failed for %s, falling back to original: %s\nModel return:\n%s",
                skill_root,
                exc,
                model_return,
            )
            resolved = build_fallback_resolved_skill(original_root)
            validate_resolved_skill(resolved, original_root)
            self._write_resolved(skill_root, resolved)
            if self._is_markdown_only_skill(original_root):
                diagnostics = SkillResolverDiagnostics(
                    status="resolved",
                    message="No executable action resolved for markdown-only skill.",
                )
            else:
                diagnostics = SkillResolverDiagnostics(
                    status="fallback_original",
                    message=str(exc),
                    fallback_to_original=True,
                )
        self._write_json(skill_root / RESOLVED_STATUS_FILE, diagnostics.model_dump())

    @staticmethod
    def _is_markdown_only_skill(original_root: Path) -> bool:
        files = [path for path in original_root.rglob("*") if path.is_file()]
        return bool(files) and all(path.suffix.lower() == ".md" for path in files)

    def _write_resolved(self, skill_root: Path, resolved) -> None:
        resolved_root = skill_root / "resolved"
        if resolved_root.exists():
            shutil.rmtree(resolved_root)
        original_root = skill_root / ORIGINAL_DIR
        cortex_root = skill_root / RESOLVED_CORTEX_DIR
        cortex_root.mkdir(parents=True, exist_ok=True)
        for cortex_file in resolved.cortex:
            target = cortex_root / cortex_file.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original_root / cortex_file.name, target)
        self._write_json(
            skill_root / RESOLVED_ACTIONS_FILE,
            build_actions_manifest(resolved.actions).model_dump(),
        )

    @staticmethod
    def _write_json(path: Path, data) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_zip_member_name(name: str) -> str:
    return name.replace("\\", "/")


def _safe_zip_stored_name(name: str, prefix: str) -> str:
    normalized = _normalize_zip_member_name(name)
    if normalized.startswith("/"):
        return ""
    if prefix and normalized.startswith(prefix):
        normalized = normalized[len(prefix) :]
    path = PurePosixPath(normalized)
    if not normalized or any(part in {"", ".", ".."} or ":" in part for part in path.parts):
        return ""
    return path.as_posix()


def _is_pycache_path(value: str) -> bool:
    path = PurePosixPath(str(value).replace("\\", "/"))
    return "__pycache__" in path.parts


def _zip_original_skill(skill_root: Path) -> bytes:
    original_root = skill_root / ORIGINAL_DIR
    if not original_root.is_dir():
        raise ValueError("original skill directory is required")
    buf = io.BytesIO()
    written = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(original_root.rglob("*")):
            if not path.is_file():
                continue
            rel_path = path.relative_to(original_root).as_posix()
            if _is_pycache_path(rel_path):
                continue
            archive.write(path, rel_path)
            written += 1
    if written == 0:
        raise ValueError("original skill directory has no files to upload")
    return buf.getvalue()


def _has_original_diff(previous_original_root: Path, original_root: Path) -> bool:
    context = build_update_context(previous_original_root, original_root)
    return bool(context.get("changed_files"))


def _copy_previous_resolved(previous_version_base: Path, skill_root: Path) -> bool:
    previous_resolved = previous_version_base / RESOLVED_DIR
    if not previous_resolved.is_dir():
        return False
    target_resolved = skill_root / RESOLVED_DIR
    if target_resolved.exists():
        shutil.rmtree(target_resolved)
    shutil.copytree(previous_resolved, target_resolved)
    previous_status = previous_version_base / RESOLVED_STATUS_FILE
    if previous_status.is_file():
        shutil.copy2(previous_status, skill_root / RESOLVED_STATUS_FILE)
    return True


def _safe_child_path(root: Path, relative_path: str) -> Path:
    root = root.resolve()
    target = (root / relative_path).resolve()
    if not target.is_relative_to(root):
        raise ValueError(f"invalid skill file path: {relative_path}")
    return target
