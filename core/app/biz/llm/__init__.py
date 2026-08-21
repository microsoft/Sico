"""LLMHub gRPC service — re-exports from service module."""

from app.biz.llm.service import LLMHubService

__all__ = ["LLMHubService"]
