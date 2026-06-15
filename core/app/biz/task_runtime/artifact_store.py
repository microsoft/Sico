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

import mimetypes
import os
import shutil
import tempfile
from pathlib import Path
from typing import Protocol
from urllib.parse import quote, unquote, urlparse

import requests

from .models import ArtifactRef


class ArtifactStore(Protocol):
    def put(self, run_id: str, name: str, src_path: Path, *, artifact_type: str = "file", role: str = "raw") -> ArtifactRef: ...
    def get(self, uri: str) -> Path: ...


class FileArtifactStore:
    def __init__(self, root: Path, *, uri_prefix: str = "file://") -> None:
        self.root = root
        self.uri_prefix = uri_prefix
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, run_id: str, name: str, src_path: Path, *, artifact_type: str = "file", role: str = "raw") -> ArtifactRef:
        target = self.root / run_id / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, target)
        return ArtifactRef(
            name=name,
            type=_normalize_artifact_type(artifact_type),
            role=_normalize_role(role),
            uri=self.uri_prefix + target.as_posix(),
            size_bytes=target.stat().st_size,
            metadata={"storage": "file", "path": str(target)},
        )

    def get(self, uri: str) -> Path:
        if not uri.startswith(self.uri_prefix):
            raise ValueError(f"unsupported artifact uri: {uri}")
        path = Path(uri[len(self.uri_prefix) :])
        if not path.exists():
            raise FileNotFoundError(path)
        return path


class SeaweedFSArtifactStore:
    def __init__(
        self,
        endpoint: str,
        *,
        path_prefix: str = "task-runtime",
        public_base_url: str = "/storage",
        cache_root: Path | None = None,
        session: requests.Session | None = None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.path_prefix = _safe_relative_path(path_prefix)
        self.public_base_url = public_base_url.rstrip("/")
        self.cache_root = cache_root or Path(tempfile.gettempdir()) / "sico-task-runtime-artifacts"
        self.session = session or requests.Session()
        self.cache_root.mkdir(parents=True, exist_ok=True)

    def put(self, run_id: str, name: str, src_path: Path, *, artifact_type: str = "file", role: str = "raw") -> ArtifactRef:
        if not src_path.exists() or not src_path.is_file():
            raise FileNotFoundError(src_path)
        object_path = self._object_path(run_id, name)
        with src_path.open("rb") as content:
            response = self.session.post(
                self._endpoint_url(object_path),
                files={"file": (Path(name).name, content, _content_type(src_path))},
                timeout=60,
            )
        if response.status_code not in {200, 201}:
            raise RuntimeError(f"SeaweedFS upload failed with status {response.status_code}: {response.text}")
        return ArtifactRef(
            name=name,
            type=_normalize_artifact_type(artifact_type),
            role=_normalize_role(role),
            uri=self._public_uri(object_path),
            size_bytes=src_path.stat().st_size,
            metadata={"storage": "seaweedfs", "object_path": object_path},
        )

    def get(self, uri: str) -> Path:
        object_path = self._object_path_from_uri(uri)
        target = self.cache_root / object_path
        target.parent.mkdir(parents=True, exist_ok=True)
        response = self.session.get(self._endpoint_url(object_path), timeout=60)
        if response.status_code != 200:
            raise FileNotFoundError(uri)
        target.write_bytes(response.content)
        return target

    def _object_path(self, run_id: str, name: str) -> str:
        return _safe_relative_path(f"{self.path_prefix}/{run_id}/{name}")

    def _endpoint_url(self, object_path: str) -> str:
        return f"{self.endpoint}/{quote(object_path, safe='/')}"

    def _public_uri(self, object_path: str) -> str:
        return f"{self.public_base_url}/{quote(object_path, safe='/')}"

    def _object_path_from_uri(self, uri: str) -> str:
        if uri.startswith(self.public_base_url + "/"):
            return _safe_relative_path(unquote(uri[len(self.public_base_url) + 1 :]))
        if uri.startswith(self.endpoint + "/"):
            return _safe_relative_path(unquote(uri[len(self.endpoint) + 1 :]))
        parsed = urlparse(uri)
        if parsed.scheme in {"http", "https"}:
            path = unquote(parsed.path)
            if path.startswith(self.public_base_url + "/"):
                path = path[len(self.public_base_url) + 1 :]
            return _safe_relative_path(path.lstrip("/"))
        raise ValueError(f"unsupported artifact uri: {uri}")


def default_artifact_store(local_root: Path) -> ArtifactStore:
    backend = os.getenv("TASK_RUNTIME_ARTIFACT_STORE", "").strip().lower()
    endpoint = os.getenv("SEAWEEDFS_ENDPOINT", "").strip()
    if backend in {"seaweedfs", "object", "blob"} or (not backend and endpoint):
        if not endpoint:
            raise ValueError("SEAWEEDFS_ENDPOINT is required for seaweedfs task runtime artifacts")
        return SeaweedFSArtifactStore(
            endpoint,
            path_prefix=os.getenv("TASK_RUNTIME_ARTIFACT_PREFIX", "task-runtime"),
            public_base_url=os.getenv("TASK_RUNTIME_ARTIFACT_PUBLIC_BASE_URL", "/storage"),
            cache_root=local_root / ".cache",
        )
    return FileArtifactStore(local_root)


def _content_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def _safe_relative_path(value: str) -> str:
    parts = [part for part in value.replace("\\", "/").split("/") if part not in {"", "."}]
    if any(part == ".." for part in parts):
        raise ValueError(f"artifact path escapes storage prefix: {value}")
    return "/".join(parts)


def _normalize_artifact_type(value: str) -> str:
    allowed = {"log", "report", "screenshot", "video", "file", "patch", "json", "trajectory"}
    return value if value in allowed else "file"


def _normalize_role(value: str) -> str:
    allowed = {"primary", "evidence", "debug", "raw"}
    return value if value in allowed else "raw"
