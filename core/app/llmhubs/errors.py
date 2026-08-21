from __future__ import annotations


class LLMHubRuntimeError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: int | None = None,
        model: str | None = None,
        provider_template_type: int | None = None,
        latency_ms: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.model = model
        self.provider_template_type = provider_template_type
        self.latency_ms = latency_ms
