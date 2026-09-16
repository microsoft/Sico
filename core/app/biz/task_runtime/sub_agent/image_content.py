from __future__ import annotations

import base64
import mimetypes
from pathlib import Path

from .loop import AgentContent


def image_data_url(content: AgentContent) -> str:
    local_path = content.metadata.get("local_path")
    if isinstance(local_path, str) and local_path:
        try:
            payload = Path(local_path).read_bytes()
        except OSError:
            pass
        else:
            mime_type = content.mime_type or mimetypes.guess_type(local_path)[0] or "application/octet-stream"
            encoded = base64.b64encode(payload).decode("ascii")
            return f"data:{mime_type};base64,{encoded}"
    return content.uri
