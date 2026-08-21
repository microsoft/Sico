from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from contextlib import suppress
from typing import Any
from urllib.parse import urlparse

from opentelemetry import metrics, trace
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.context import Context
from opentelemetry.propagate import extract, set_global_textmap
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.propagators.textmap import Getter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

LOGGER = logging.getLogger(__name__)


def _parse_bool(value: str | None, default: bool = False) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _signal_endpoint(signal: str) -> tuple[str | None, bool]:
    signal_key = f"OTEL_EXPORTER_OTLP_{signal.upper()}_ENDPOINT"
    raw = os.getenv(signal_key, "").strip() or os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if not raw:
        return None, False

    signal_insecure = os.getenv(signal_key.replace("_ENDPOINT", "_INSECURE"))
    global_insecure = os.getenv("OTEL_EXPORTER_OTLP_INSECURE")
    insecure = _parse_bool(signal_insecure, _parse_bool(global_insecure))
    parsed = urlparse(raw)
    if parsed.scheme in {"http", "https"}:
        if signal_insecure is None and global_insecure is None:
            insecure = parsed.scheme == "http"
        raw = parsed.netloc or parsed.path
    return raw, insecure


def setup_otel(service_name_default: str = "sico-core") -> Callable[[], None]:
    set_global_textmap(CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()]))
    service_name = os.getenv("OTEL_SERVICE_NAME", service_name_default).strip() or service_name_default
    resource = Resource.create({SERVICE_NAME: service_name})
    telemetry_enabled = _parse_bool(os.getenv("ENABLE_TELEMETRY"), True)

    tracer_provider = TracerProvider(resource=resource)
    trace_endpoint, trace_insecure = _signal_endpoint("traces")
    if telemetry_enabled and trace_endpoint:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

        tracer_provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=trace_endpoint, insecure=trace_insecure))
        )
    trace.set_tracer_provider(tracer_provider)

    meter_provider = _setup_metrics(resource) if telemetry_enabled else None
    logger_provider, logging_handler = _setup_logging(resource) if telemetry_enabled else (None, None)

    try:
        from opentelemetry.instrumentation.grpc import GrpcInstrumentorClient

        GrpcInstrumentorClient().instrument()
    except Exception:
        LOGGER.debug("OpenTelemetry grpcio instrumentation unavailable", exc_info=True)

    try:
        from agent_framework.observability import enable_instrumentation

        enable_instrumentation()
    except Exception:
        LOGGER.debug("Agent Framework instrumentation unavailable", exc_info=True)

    def shutdown() -> None:
        if logging_handler is not None:
            logging.getLogger().removeHandler(logging_handler)
        with suppress(Exception):
            if logger_provider is not None:
                logger_provider.shutdown()
        with suppress(Exception):
            if meter_provider is not None:
                meter_provider.shutdown()
        with suppress(Exception):
            tracer_provider.shutdown()

    return shutdown


def _setup_metrics(resource: Resource):
    endpoint, insecure = _signal_endpoint("metrics")
    if not endpoint:
        return None
    try:
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader

        provider = MeterProvider(
            resource=resource,
            metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter(endpoint=endpoint, insecure=insecure))],
        )
        metrics.set_meter_provider(provider)
        return provider
    except Exception:
        LOGGER.exception("Failed to initialize OTLP metrics exporter")
        return None


def _setup_logging(resource: Resource):
    endpoint, insecure = _signal_endpoint("logs")
    if not endpoint:
        return None, None
    try:
        from opentelemetry._logs import set_logger_provider
        from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor

        provider = LoggerProvider(resource=resource)
        provider.add_log_record_processor(
            BatchLogRecordProcessor(OTLPLogExporter(endpoint=endpoint, insecure=insecure))
        )
        set_logger_provider(provider)
        handler = LoggingHandler(level=logging.NOTSET, logger_provider=provider)
        logging.getLogger().addHandler(handler)
        return provider, handler
    except Exception:
        LOGGER.exception("Failed to initialize OTLP logs exporter")
        return None, None


def _value_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list | tuple):
        return [str(item) for item in value if item is not None]
    return [str(value)]


class _MetadataGetter(Getter[object]):
    def get(self, carrier: object, key: str) -> list[str]:
        if carrier is None:
            return []
        getall = getattr(carrier, "getall", None)
        if callable(getall):
            try:
                return _value_list(getall(key.lower()))
            except KeyError:
                return []
        get = getattr(carrier, "get", None)
        if callable(get):
            return _value_list(get(key.lower()))
        if isinstance(carrier, Mapping):
            return _value_list(carrier.get(key.lower()))
        return []

    def keys(self, carrier: object) -> list[str]:
        if carrier is None:
            return []
        keys = getattr(carrier, "keys", None)
        if callable(keys):
            return [str(key).lower() for key in keys()]
        if isinstance(carrier, Mapping):
            return [str(key).lower() for key in carrier]
        return []


METADATA_GETTER = _MetadataGetter()


def _handler_value(handler: Any, name: str, index: int) -> Any:
    value = getattr(handler, name, None)
    if value is not None:
        return value
    try:
        return handler[index]
    except Exception:
        return None


def _wrapped_handler(tracer: Any, path: str, function: Any):
    normalized_path = path[1:] if path.startswith("/") else path
    service, _, method = normalized_path.partition("/")

    async def wrapped(stream: Any):
        parent_context: Context = extract(getattr(stream, "metadata", None), getter=METADATA_GETTER)
        with tracer.start_as_current_span(
            path,
            context=parent_context,
            kind=SpanKind.SERVER,
            attributes={"rpc.system": "grpc", "rpc.service": service, "rpc.method": method},
        ) as span:
            try:
                await function(stream)
                span.set_status(Status(StatusCode.OK))
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
                raise

    return wrapped


def instrument_grpclib_services(services: list[Any]) -> list[Any]:
    try:
        from grpclib.const import Handler
    except Exception:
        return services

    tracer = trace.get_tracer("sico-core/grpclib")
    for service in services:
        original_mapping = getattr(service, "__mapping__", None)
        if not callable(original_mapping):
            continue

        def wrapped_mapping(original_mapping=original_mapping):
            mapping = original_mapping()
            wrapped = {}
            for path, handler in mapping.items():
                function = _handler_value(handler, "func", 0)
                cardinality = _handler_value(handler, "cardinality", 1)
                if function is None or cardinality is None:
                    wrapped[path] = handler
                    continue
                wrapped[path] = Handler(
                    _wrapped_handler(tracer, path, function),
                    cardinality,
                    _handler_value(handler, "request_type", 2),
                    _handler_value(handler, "reply_type", 3),
                )
            return wrapped

        setattr(service, "__mapping__", wrapped_mapping)
    return services
