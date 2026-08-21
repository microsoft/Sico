from __future__ import annotations

from collections.abc import Mapping

import requests


def post_file(
    url: str,
    *,
    field_name: str = "file",
    file_name: str,
    data: bytes,
    content_type: str,
    form_data: Mapping[str, str] | None = None,
    timeout: float = 60,
) -> requests.Response:
    return requests.post(
        url,
        data=dict(form_data) if form_data else None,
        files={field_name: (file_name, data, content_type)},
        timeout=timeout,
    )
