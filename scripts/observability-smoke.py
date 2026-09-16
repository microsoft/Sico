import http.client
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


GRAFANA_URL = os.getenv("OBSERVABILITY_GRAFANA_URL", "http://localhost:14005").rstrip("/")
OTLP_HTTP_URL = os.getenv("OBSERVABILITY_OTLP_HTTP_URL", "http://localhost:14007").rstrip("/")
TIMEOUT_SECONDS = float(os.getenv("OBSERVABILITY_SMOKE_TIMEOUT", "60"))
SERVICE_NAME = "sico-observability-smoke"
TRANSIENT_ERRORS = (http.client.HTTPException, urllib.error.URLError, json.JSONDecodeError, OSError)


def request_json(url: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def datasource_url(uid: str, path: str, query: dict[str, str] | None = None) -> str:
    url = f"{GRAFANA_URL}/api/datasources/proxy/uid/{uid}/{path.lstrip('/')}"
    return f"{url}?{urllib.parse.urlencode(query)}" if query else url


def resource(run_id: str) -> dict:
    return {
        "attributes": [
            {"key": "service.name", "value": {"stringValue": SERVICE_NAME}},
            {"key": "smoke.run_id", "value": {"stringValue": run_id}},
        ]
    }


def submit_signals(run_id: str, trace_id: str, span_id: str, timestamp_ns: str) -> None:
    request_json(
        f"{OTLP_HTTP_URL}/v1/traces",
        {
            "resourceSpans": [{
                "resource": resource(run_id),
                "scopeSpans": [{"spans": [{
                    "traceId": trace_id,
                    "spanId": span_id,
                    "name": "phase7-smoke",
                    "kind": 1,
                    "startTimeUnixNano": timestamp_ns,
                    "endTimeUnixNano": str(int(timestamp_ns) + 1_000_000),
                    "attributes": [{"key": "smoke.run_id", "value": {"stringValue": run_id}}],
                }]}],
            }]
        },
    )
    request_json(
        f"{OTLP_HTTP_URL}/v1/metrics",
        {
            "resourceMetrics": [{
                "resource": resource(run_id),
                "scopeMetrics": [{"metrics": [{
                    "name": "sico.phase7.smoke",
                    "gauge": {"dataPoints": [{
                        "timeUnixNano": timestamp_ns,
                        "asInt": "1",
                        "attributes": [{"key": "smoke.run_id", "value": {"stringValue": run_id}}],
                    }]},
                }]}],
            }]
        },
    )
    request_json(
        f"{OTLP_HTTP_URL}/v1/logs",
        {
            "resourceLogs": [{
                "resource": resource(run_id),
                "scopeLogs": [{"logRecords": [{
                    "timeUnixNano": timestamp_ns,
                    "severityNumber": 9,
                    "severityText": "INFO",
                    "body": {"stringValue": f"phase7 observability smoke {run_id}"},
                    "traceId": trace_id,
                    "spanId": span_id,
                    "attributes": [{"key": "smoke.run_id", "value": {"stringValue": run_id}}],
                }]}],
            }]
        },
    )


def signals_are_queryable(run_id: str, trace_id: str) -> tuple[bool, list[str]]:
    pending = []

    trace = request_json(datasource_url("tempo", f"api/traces/{trace_id}"))
    if not trace.get("batches"):
        pending.append("trace")

    metric = request_json(datasource_url("prometheus", "api/v1/query", {"query": f'sico_phase7_smoke{{smoke_run_id="{run_id}"}}'}))
    if not metric.get("data", {}).get("result"):
        pending.append("metric")

    logs = request_json(
        datasource_url(
            "loki",
            "loki/api/v1/query_range",
            {"query": f'{{service_name="{SERVICE_NAME}"}} |= `{run_id}`', "limit": "1"},
        )
    )
    if not logs.get("data", {}).get("result"):
        pending.append("log")

    return not pending, pending


def main() -> int:
    run_id = secrets.token_hex(8)
    trace_id = secrets.token_hex(16)
    span_id = secrets.token_hex(8)
    timestamp_ns = str(time.time_ns())

    deadline = time.monotonic() + TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            request_json(f"{GRAFANA_URL}/api/health")
            break
        except TRANSIENT_ERRORS:
            time.sleep(2)
    else:
        print(f"Observability smoke timed out waiting for Grafana at {GRAFANA_URL}", file=sys.stderr)
        return 1

    try:
        submit_signals(run_id, trace_id, span_id, timestamp_ns)
        deadline = time.monotonic() + TIMEOUT_SECONDS
        pending = ["trace", "metric", "log"]
        while time.monotonic() < deadline:
            try:
                complete, pending = signals_are_queryable(run_id, trace_id)
                if complete:
                    print(f"Observability smoke passed: trace={trace_id} run_id={run_id}")
                    return 0
            except TRANSIENT_ERRORS:
                pass
            time.sleep(2)
    except TRANSIENT_ERRORS as error:
        print(f"Observability smoke setup failed: {error}", file=sys.stderr)
        return 1

    print(f"Observability smoke timed out waiting for: {', '.join(pending)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
