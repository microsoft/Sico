"""Build the dict payloads returned to the LLM from task-runtime batch results."""

from __future__ import annotations

from typing import Any

from .display import failure_reason_label
from ...domain.models import (
    BatchResult,
    BatchResultDigest,
    TaskResult,
    TaskResultDigest,
    TaskRun,
    TaskStatus,
)
from .artifact_links import _is_report_artifact, _public_artifact_url

_COMPACT_RESULT_LIMIT = 10
_COMPACT_URL_LIMIT = 50
_COMPACT_RUN_ID_LIMIT = 500


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
    payload = BatchResultDigest.from_result(
        result,
        max_success_items=max_success,
        max_result_items=None if keep_full_structure else _COMPACT_RESULT_LIMIT,
    ).model_dump(
        mode="json",
        exclude_none=True,
        exclude={"results": {"__all__": {"trajectory_ref": True, "primary_artifact": {"metadata": True}}}},
    )
    _add_failure_reason_labels(payload, result.results)
    _add_artifact_response_hints(payload)
    _add_all_artifact_response_hints(payload, result.results)
    if not keep_full_structure:
        _add_omitted_result_hint(payload, result)
        _add_omitted_result_ids(payload, result.results)
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


def _add_omitted_result_ids(payload: dict[str, Any], results: list[TaskResult]) -> None:
    shown = {
        str(item.get("run_id") or "")
        for item in payload.get("results", [])
        if isinstance(item, dict)
    }
    omitted_success = [
        result.run_id for result in results if result.status == TaskStatus.COMPLETED and result.run_id not in shown
    ]
    omitted_non_success = [
        result.run_id for result in results if result.status != TaskStatus.COMPLETED and result.run_id not in shown
    ]
    _add_bounded_run_ids(payload, "success", omitted_success)
    _add_bounded_run_ids(payload, "non_success", omitted_non_success)


def _add_bounded_run_ids(payload: dict[str, Any], status: str, run_ids: list[str]) -> None:
    if not run_ids:
        return
    payload[f"omitted_{status}_run_ids"] = run_ids[:_COMPACT_RUN_ID_LIMIT]
    if len(run_ids) > _COMPACT_RUN_ID_LIMIT:
        payload[f"omitted_{status}_run_id_count"] = len(run_ids)
        payload[f"unlisted_omitted_{status}_run_id_count"] = len(run_ids) - _COMPACT_RUN_ID_LIMIT


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
        for item in results:
            if isinstance(item, dict):
                _add_artifact_response_hints(item)
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
    else:
        payload["artifact_url"] = public_url


def _add_all_artifact_response_hints(payload: dict[str, Any], results: list[TaskResult]) -> None:
    report_urls: list[str] = []
    artifact_urls: list[str] = []
    for result in results:
        artifact = result.primary_artifact
        if artifact is None or not artifact.uri:
            continue
        url = _public_artifact_url(artifact.uri)
        target = report_urls if _is_report_artifact(artifact.model_dump(mode="json")) else artifact_urls
        if url not in target:
            target.append(url)
    if report_urls:
        payload["report_urls"] = report_urls[:_COMPACT_URL_LIMIT]
        payload["report_url_count"] = len(report_urls)
        if len(report_urls) > _COMPACT_URL_LIMIT:
            payload["omitted_report_url_count"] = len(report_urls) - _COMPACT_URL_LIMIT
    if artifact_urls:
        payload["artifact_urls"] = artifact_urls[:_COMPACT_URL_LIMIT]
        payload["artifact_url_count"] = len(artifact_urls)
        if len(artifact_urls) > _COMPACT_URL_LIMIT:
            payload["omitted_artifact_url_count"] = len(artifact_urls) - _COMPACT_URL_LIMIT


def _add_playbook_hint_payload(payload: dict[str, Any], run: TaskRun) -> None:
    hints = run.spec.args.get("playbook_hints")
    if isinstance(hints, list) and hints:
        payload["playbook_hints"] = hints
    shown = run.spec.args.get("playbook_shown_bullet_ids")
    if isinstance(shown, list) and shown:
        payload["shown_bullet_ids"] = shown
