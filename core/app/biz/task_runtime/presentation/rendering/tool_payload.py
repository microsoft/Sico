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

"""Build the dict payloads returned to the LLM from task-runtime batch results."""

from __future__ import annotations

from typing import Any

from .display import failure_reason_label
from ...models import (
    BatchResult,
    BatchResultDigest,
    TaskResult,
    TaskResultDigest,
    TaskRun,
)
from .artifact_links import _is_report_artifact, _public_artifact_url


def result_to_tool_payload(result: BatchResult, *, keep_full_structure: bool = False) -> dict:
    if not keep_full_structure and result.total_count == 1 and result.results:
        payload = TaskResultDigest.from_result(result.results[0]).model_dump(
            mode="json",
            exclude_none=True,
            exclude={"trajectory_ref": True, "primary_artifact": {"metadata": True}},
        )
        _add_failure_reason_labels(payload, result.results)
        _add_artifact_response_hints(payload)
        return payload
    max_success = len(result.results) if keep_full_structure else 3
    payload = BatchResultDigest.from_result(result, max_success_items=max_success).model_dump(
        mode="json",
        exclude_none=True,
        exclude={"results": {"__all__": {"trajectory_ref": True, "primary_artifact": {"metadata": True}}}},
    )
    _add_failure_reason_labels(payload, result.results)
    _add_artifact_response_hints(payload)
    if not keep_full_structure:
        _add_omitted_result_hint(payload, result)
    return payload


def _add_omitted_result_hint(payload: dict[str, Any], result: BatchResult) -> None:
    if result.total_count <= 1:
        return
    shown_results = payload.get("results")
    shown_count = len(shown_results) if isinstance(shown_results, list) else 0
    omitted_count = max(0, result.total_count - shown_count)
    if omitted_count <= 0:
        return
    payload["omitted_result_count"] = omitted_count


def _add_failure_reason_labels(payload: dict[str, Any], results: list[TaskResult]) -> None:
    if not results:
        return
    by_run_id = {result.run_id: result for result in results}
    if isinstance(payload.get("results"), list):
        for item in payload["results"]:
            if not isinstance(item, dict):
                continue
            result = by_run_id.get(str(item.get("run_id") or ""))
            _replace_error_class_with_failure_reason(item, result)
    else:
        _replace_error_class_with_failure_reason(payload, results[0])


def _replace_error_class_with_failure_reason(item: dict[str, Any], result: TaskResult | None) -> None:
    item.pop("error_class", None)
    if result is None or result.error_class is None:
        return
    item["failure_reason"] = failure_reason_label(result.error_class, result.error_message)


def _add_artifact_response_hints(payload: dict[str, Any]) -> None:
    results = payload.get("results")
    if isinstance(results, list):
        report_urls = []
        artifact_urls = []
        for item in results:
            if isinstance(item, dict):
                _add_artifact_response_hints(item)
                report_url = item.get("report_url")
                if isinstance(report_url, str) and report_url:
                    report_urls.append(report_url)
                artifact_url = item.get("artifact_url")
                if isinstance(artifact_url, str) and artifact_url:
                    artifact_urls.append(artifact_url)
        if report_urls:
            payload["report_urls"] = report_urls
        if artifact_urls:
            payload["artifact_urls"] = artifact_urls
        return
    artifact = payload.get("primary_artifact")
    if not isinstance(artifact, dict):
        return
    uri = artifact.get("uri")
    if not isinstance(uri, str) or not uri:
        return
    public_url = _public_artifact_url(uri)
    if _is_report_artifact(artifact):
        payload["report_url"] = public_url
        return
    payload["artifact_url"] = public_url


def _add_playbook_hint_payload(payload: dict[str, Any], run: TaskRun) -> None:
    hints = run.spec.args.get("playbook_hints")
    if isinstance(hints, list) and hints:
        payload["playbook_hints"] = hints
    shown = run.spec.args.get("playbook_shown_bullet_ids")
    if isinstance(shown, list) and shown:
        payload["shown_bullet_ids"] = shown
