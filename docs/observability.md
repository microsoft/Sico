# Local observability

Sico exports traces, metrics, and logs with OpenTelemetry. Docker Compose and
Kind route all three signals to the pinned `grafana/otel-lgtm:0.11.10` local
development stack. Hosted deployments route the same OTLP signals to their
configured collector; application code does not select Grafana or Azure.

LGTM is intended for local development, testing, and demos. It is not a
production observability deployment.

## Endpoints and credentials

| Endpoint | Default | Purpose |
| --- | --- | --- |
| Grafana | http://localhost:14005 | Explore traces, metrics, and logs (`admin` / `admin`) |
| OTLP/gRPC | `localhost:14006` | Host-side SDKs and tools using OTLP/gRPC |
| OTLP/HTTP | http://localhost:14007 | Host-side SDKs and tools using OTLP/HTTP |

Backend and Core containers use `otel-lgtm:4317`. Kind pods use
`sico-otel-lgtm.sico.svc.cluster.local:4317`. Both services use the
signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, and `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
before falling back to `OTEL_EXPORTER_OTLP_ENDPOINT`.

In Grafana, use **Explore** and select Tempo for traces, Prometheus for metrics,
or Loki for logs. Backend logs include trace and span IDs when a recording span
is active, so a request can be followed between signals.

## Lifecycle

Docker Compose starts LGTM as part of both local variants:

```bash
make compose-up
make observability-smoke
make compose-logs
make compose-down              # retain named-volume data
make compose-down-volumes      # delete all local Compose volumes
```

Kind also includes LGTM in both variants and creates the three port-forwards:

```bash
make kind-up
make observability-smoke
make kind-stop                  # stop containers; preserve cluster data
make kind-down                  # delete the cluster and its data
```

Set `OBSERVABILITY_PERSISTENCE_ENABLED=true` for a Kind deployment that uses a
retained 5 GiB PVC instead of pod-local `emptyDir` storage:

```bash
OBSERVABILITY_PERSISTENCE_ENABLED=true make kind-up
```

The default Kind `emptyDir` is also capped at 5 GiB. Recreating the LGTM pod
clears `emptyDir`; the optional PVC survives pod recreation but is deleted with
the Kind cluster.

## Retention and cleanup

Local logs, metrics, and traces have a seven-day retention window. Prometheus
also limits its TSDB to 2 GB. Compose stores all LGTM data in the
`sico_otel-lgtm-data` named volume; Docker does not enforce a total size on that
volume, so use `make compose-down-volumes` when a complete local reset is
needed. That target also deletes the other Compose data volumes.

Kind limits the combined `/data` volume to 5 GiB, whether it uses the default
ephemeral volume or the optional PVC. Retention is a development convenience,
not a backup policy.

## Automated smoke check

`make observability-smoke` submits a uniquely identified OTLP/HTTP trace,
metric, and log, then verifies each one through Grafana's provisioned Tempo,
Prometheus, and Loki datasources. It uses only Python's standard library.

Override its endpoints or timeout for non-default port-forwards:

```bash
OBSERVABILITY_GRAFANA_URL=http://localhost:24005 \
OBSERVABILITY_OTLP_HTTP_URL=http://localhost:24007 \
OBSERVABILITY_SMOKE_TIMEOUT=90 \
make observability-smoke
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Grafana is unavailable | Compose: `docker logs sico-otel-lgtm`; Kind: `kubectl -n sico logs deployment/sico-otel-lgtm` |
| The smoke check cannot connect | Confirm ports `14005` and `14007` are free and LGTM is healthy |
| A service has no signals | Inspect its `OTEL_EXPORTER_OTLP_*` endpoint and insecure settings, then check collector logs |
| Kind works in-cluster but not from the host | Rerun `make kind-up` to recreate the port-forward processes |
| Data disappeared in Kind | The default storage is pod-local; enable persistence before deployment to retain data across pod recreation |
| Disk use needs a full reset | Compose: `make compose-down-volumes`; Kind: `make kind-down` |

The standard Compose and Kind stacks intentionally have no LGTM opt-out. For a
service run directly on a host or in another deployment, omit all OTLP endpoint
variables to install providers without exporters. Core additionally supports
`ENABLE_TELEMETRY=false`. Hosted environments can override the global endpoint
with signal-specific endpoints without changing instrumentation.

## Dashboards

Local dashboard definitions live under `deploy/observability/dashboards/` and
are loaded through Grafana file provisioning whenever LGTM starts. Compose bind
mounts the definitions directly; Kind packages the same files into a ConfigMap.
The dashboards are read-only in Grafana because repository files are the source
of truth. Update the JSON and recreate the Compose LGTM container or rerun the
Kind deployment to publish a revision.

Dashboard definitions are independent of `/data`: deleting local telemetry or
Grafana's database does not delete them, and a fresh local launch provisions
them again. Hosted Azure dashboard provisioning remains separate from this
local Prometheus setup.