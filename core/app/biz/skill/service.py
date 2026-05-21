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
import logging
import zipfile

import requests

from app.pb.skill.skill import (
    DeleteSkillFromFsRequest,
    DeleteSkillFromFsResponse,
    ExtractSkillRequest,
    ExtractSkillResponse,
    GetSkillDetailsGrpcRequest,
    GetSkillDetailsGrpcResponse,
    SkillFile,
    SkillServiceBase,
)
from app.storage.fs import SKILLS_FS, parse_skill_frontmatter
from app.utils.response import failed_response, success_response

_LOGGER = logging.getLogger(__name__)


class SkillService(SkillServiceBase):
    """gRPC service for skill extraction and details retrieval."""

    async def extract_skill(self, message: ExtractSkillRequest) -> ExtractSkillResponse:  # type: ignore[override]
        self._logger = logging.getLogger(__name__)
        self._logger.info(
            "ExtractSkill request received: skill_id=%s project_id=%s agent_id=%s",
            message.skill_id, message.project_id, message.agent_id
        )

        # Validate exactly one scope ID
        if not message.project_id and not message.agent_id:
            return failed_response(ExtractSkillResponse(message="one of project_id or agent_id is required"))
        if message.project_id and message.agent_id:
            return failed_response(ExtractSkillResponse(message="only one of project_id or agent_id should be provided"))

        file_url = (message.download_url or "").strip()
        if not file_url:
            self._logger.warning("No download URL provided; cannot extract skill skill_id=%s", message.skill_id)
            return failed_response(ExtractSkillResponse(message="missing download url"))

        try:
            name, description = await asyncio.to_thread(
                self._download_and_extract, message.skill_id, message.project_id, message.agent_id, file_url
            )
            self._logger.info("Skill extraction succeeded skill_id=%s name=%s", message.skill_id, name)
        except Exception as exc:
            self._logger.error("Skill extraction failed skill_id=%s error=%s", message.skill_id, exc)
            return failed_response(ExtractSkillResponse(message=str(exc)))

        return success_response(ExtractSkillResponse(message="received", name=name, description=description))

    async def get_skill_details(self, message: GetSkillDetailsGrpcRequest) -> GetSkillDetailsGrpcResponse:  # type: ignore[override]
        self._logger = logging.getLogger(__name__)
        self._logger.info(
            "GetSkillDetails request received skill_id=%s project_id=%s agent_id=%s",
            message.skill_id, message.project_id, message.agent_id,
        )

        if not message.project_id and not message.agent_id:
            return failed_response(GetSkillDetailsGrpcResponse(msg="one of project_id or agent_id is required"))
        if message.project_id and message.agent_id:
            return failed_response(GetSkillDetailsGrpcResponse(msg="only one of project_id or agent_id should be provided"))

        try:
            files = await asyncio.to_thread(
                self._read_skill_files,
                message.skill_id,
                message.project_id,
                message.agent_id,
            )
            return success_response(GetSkillDetailsGrpcResponse(files=files))
        except Exception as exc:
            self._logger.error("GetSkillDetails failed skill_id=%s error=%s", message.skill_id, exc)
            return failed_response(GetSkillDetailsGrpcResponse(msg=str(exc)))

    async def delete_skill_from_fs(self, message: DeleteSkillFromFsRequest) -> DeleteSkillFromFsResponse:  # type: ignore[override]
        self._logger = logging.getLogger(__name__)
        self._logger.info(
            "DeleteSkillFromFS request received: skill_id=%s project_id=%s agent_id=%s",
            message.skill_id, message.project_id, message.agent_id,
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
            self._logger.info("Skill deleted from FS skill_id=%s", message.skill_id)
        except FileNotFoundError:
            self._logger.info("Skill not found in FS skill_id=%s, ignoring", message.skill_id)
        except Exception as exc:
            self._logger.error("DeleteSkillFromFS failed skill_id=%s error=%s", message.skill_id, exc)
            return failed_response(DeleteSkillFromFsResponse(msg=str(exc)))

        return success_response(DeleteSkillFromFsResponse())

    def _download_and_extract(self, skill_id: int, project_id: int, agent_id: str, file_url: str) -> tuple[str, str]:
        """Download the skill archive and extract it to the skill filesystem.

        Supports two upload formats:
        - A zip archive containing skill files (optionally nested under a single
          top-level directory which will be stripped).
        - A plain SKILL.md file.

        Returns (name, description) parsed from SKILL.md.
        Raises ValueError if SKILL.md is missing or name/description are empty.
        """
        _LOGGER.info("Downloading skill file from %s", file_url)
        resp = requests.get(file_url, timeout=120)
        resp.raise_for_status()

        raw = resp.content
        buf = io.BytesIO(raw)

        if zipfile.is_zipfile(buf):
            self._extract_zip(buf, skill_id, project_id, agent_id)
        else:
            # Interpret as a plain SKILL.md text file.
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                raise ValueError("uploaded file is not a valid zip archive or SKILL.md")

            metadata = parse_skill_frontmatter(text)
            if not metadata.get("name") or not metadata.get("description"):
                raise ValueError("uploaded file is not a valid zip archive or SKILL.md")

            SKILLS_FS.write_text(
                skill_id, "SKILL.md", text,
                project_id=project_id, agent_id=agent_id,
            )
            return metadata["name"], metadata["description"]

        # For zip archives: read back the extracted SKILL.md and parse metadata.
        skill_md_content = SKILLS_FS.read_text(
            skill_id, "SKILL.md",
            project_id=project_id, agent_id=agent_id,
        )
        metadata = parse_skill_frontmatter(skill_md_content)
        name = metadata.get("name", "")
        description = metadata.get("description", "")

        if not name or not description:
            raise ValueError("SKILL.md must contain non-empty name and description")

        return name, description

    @staticmethod
    def _detect_top_level_dir(names: list[str]) -> str:
        """Return the common top-level directory if all entries share one, else ''."""
        if not names:
            return ""
        parts = [n.split("/", 1) for n in names]
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
    ) -> None:
        """Extract a zip archive into the skill filesystem.

        If all files share a single top-level directory, that prefix is stripped
        so files are stored directly under the skill directory.
        Raises ValueError if no SKILL.md is found in the archive.
        """
        buf.seek(0)
        with zipfile.ZipFile(buf, "r") as zf:
            file_entries = [
                info for info in zf.infolist()
                if not info.is_dir()
                and not info.filename.startswith("__MACOSX/")
                and not info.filename.endswith("/.DS_Store")
                and info.filename != ".DS_Store"
            ]
            raw_names = [info.filename for info in file_entries]

            # Detect and strip common top-level directory
            prefix = self._detect_top_level_dir(raw_names)

            has_skill_md = False
            for info in file_entries:
                name = info.filename
                # Prevent path traversal
                if name.startswith("/") or ".." in name:
                    continue

                # Strip the common top-level directory prefix
                stored_name = name[len(prefix):] if prefix else name
                if not stored_name:
                    continue

                if stored_name == "SKILL.md":
                    has_skill_md = True

                content = zf.read(name).decode("utf-8", errors="replace")
                SKILLS_FS.write_text(
                    skill_id,
                    stored_name,
                    content,
                    project_id=project_id,
                    agent_id=agent_id,
                )

            if not has_skill_md:
                raise ValueError("SKILL.md is required but not found in the uploaded archive")

    def _read_skill_files(
        self,
        skill_id: int,
        project_id: int,
        agent_id: str,
    ) -> list[SkillFile]:
        """Read all files for a skill from the filesystem."""
        # Determine the skill directory path
        if project_id:
            base = SKILLS_FS._root / "project" / str(project_id) / SKILLS_FS._resource_dir / str(skill_id)
        else:
            base = SKILLS_FS._root / "agent" / str(agent_id) / SKILLS_FS._resource_dir / str(skill_id)

        if not base.exists():
            return []

        files: list[SkillFile] = []
        for p in sorted(base.rglob("*")):
            if not p.is_file():
                continue
            rel_path = p.relative_to(base).as_posix()
            try:
                content = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                content = ""
            files.append(SkillFile(path=rel_path, content=content))
        return files
