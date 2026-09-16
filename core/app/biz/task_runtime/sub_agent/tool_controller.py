"""Per-run progressive capability discovery and native tool promotion."""

from __future__ import annotations

import asyncio
import base64
import json
import math
import re
from collections import Counter
from collections.abc import Sequence

from ..capabilities.descriptors import CapabilityDescriptor, CatalogueQuery
from ..capabilities.ids import normalize_capability_selector
from ..domain.models import ErrorClass, TaskRun
from .invoker import AgentInvocationContext, CapabilityInvoker
from .loop import (
    AgentLoopSnapshot,
    AgentToolDescriptor,
    AgentToolsetSnapshot,
    BoundAgentTool,
    CapabilityCall,
    Observation,
)
from .profile import AgentProfile, ceiling_allows

CAPABILITY_DISCOVER_TOOL_ID = "runtime:capability:discover"
MAX_SEARCH_PROMOTIONS = 5
MAX_PROMOTED_SCHEMA_BYTES = 30_000
MAX_BROWSE_PAGE_SIZE = 50
_SEARCH_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")


class RuntimeAgentToolController:
    """Expose one discovery tool and atomically add authorized native tools."""

    def __init__(self, run: TaskRun, profile: AgentProfile, invoker: CapabilityInvoker) -> None:
        self._run = run
        self._profile = profile
        self._invoker = invoker
        self._lock = asyncio.Lock()
        discover = BoundAgentTool(self._discover_descriptor(), self._discover)
        self._tools: dict[str, BoundAgentTool] = {CAPABILITY_DISCOVER_TOOL_ID: discover}
        self._revision = 1
        self._promoted_schema_bytes = 0

    async def snapshot(self) -> AgentToolsetSnapshot:
        async with self._lock:
            return AgentToolsetSnapshot(revision=self._revision, tools=tuple(self._tools.values()))

    @staticmethod
    def _discover_descriptor() -> AgentToolDescriptor:
        return AgentToolDescriptor(
            tool_id=CAPABILITY_DISCOVER_TOOL_ID,
            description=(
                "Discover capabilities authorized by your profile. action='search' ranks matches and automatically "
                "promotes up to 5 full-schema native tools within a 30 KB schema budget; call a promoted capability "
                "directly on the next turn. action='browse' returns compact metadata, total, and pagination cursor but "
                "never promotes tools. Use browse for inventory/listing questions, and search for execution."
            ),
            parameter_schema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "browse"]},
                    "query": {"type": "string"},
                    "selectors": {"type": "array", "items": {"type": "string"}},
                    "providers": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "integer", "minimum": 1, "maximum": MAX_SEARCH_PROMOTIONS},
                    "page_size": {"type": "integer", "minimum": 1, "maximum": MAX_BROWSE_PAGE_SIZE},
                    "cursor": {"type": "string"},
                },
                "required": ["action"],
                "additionalProperties": False,
            },
        )

    async def _discover(self, call: CapabilityCall, snapshot: AgentLoopSnapshot) -> Observation:
        action = str(call.args.get("action") or "").strip().lower()
        if action == "search":
            return await self._search(call, snapshot)
        if action == "browse":
            return await self._browse(call)
        return _failed_observation(call, "action must be 'search' or 'browse'.")

    async def _search(self, call: CapabilityCall, snapshot: AgentLoopSnapshot) -> Observation:
        query = str(call.args.get("query") or "").strip()
        filters = _filters(call)
        if isinstance(filters, str):
            return _failed_observation(call, filters)
        providers, selectors = filters
        if not query and not selectors:
            return _failed_observation(call, "search requires query or selectors; use browse to list capabilities.")
        try:
            limit = min(MAX_SEARCH_PROMOTIONS, max(1, int(call.args.get("limit") or MAX_SEARCH_PROMOTIONS)))
        except (TypeError, ValueError):
            return _failed_observation(call, "limit must be an integer.")
        descriptors = await self._authorized_descriptors(providers=providers, selectors=selectors, search=query)
        ranked = (
            _rank_descriptors(query, descriptors)
            if query
            else tuple(sorted(descriptors, key=lambda item: item.capability_id))
        )
        promoted, skipped = await self._promote(ranked[:limit], snapshot)
        current = await self.snapshot()
        payload = {
            "action": "search",
            "matches": [_compact_payload(descriptor) for descriptor in ranked[:limit]],
            "promoted_capability_ids": list(promoted),
            "skipped_schema_budget": list(skipped),
            "toolset_revision": current.revision,
        }
        return _successful_observation(call, payload, f"Promoted {len(promoted)} capability tools.")

    async def _browse(self, call: CapabilityCall) -> Observation:
        filters = _filters(call)
        if isinstance(filters, str):
            return _failed_observation(call, filters)
        providers, selectors = filters
        try:
            page_size = min(MAX_BROWSE_PAGE_SIZE, max(1, int(call.args.get("page_size") or 20)))
            offset = _decode_cursor(str(call.args.get("cursor") or ""))
        except (TypeError, ValueError):
            return _failed_observation(call, "page_size or cursor is invalid.")
        if offset < 0:
            return _failed_observation(call, "cursor must not be negative.")
        descriptors = tuple(
            sorted(
                await self._authorized_descriptors(providers=providers, selectors=selectors),
                key=lambda item: item.capability_id,
            )
        )
        page = descriptors[offset : offset + page_size]
        next_offset = offset + len(page)
        current = await self.snapshot()
        payload = {
            "action": "browse",
            "capabilities": [_compact_payload(descriptor) for descriptor in page],
            "total": len(descriptors),
            "next_cursor": _encode_cursor(next_offset) if next_offset < len(descriptors) else "",
            "toolset_revision": current.revision,
        }
        return _successful_observation(call, payload, f"Listed {len(page)} of {len(descriptors)} capabilities.")

    async def _authorized_descriptors(
        self,
        *,
        providers: tuple[str, ...],
        selectors: tuple[str, ...],
        search: str = "",
    ) -> tuple[CapabilityDescriptor, ...]:
        descriptors = await self._invoker.list_descriptors(
            self._run,
            CatalogueQuery(
                providers=providers,
                selectors=selectors,
                search=search,
                include_internal=True,
            ),
        )
        return tuple(
            descriptor
            for descriptor in descriptors
            if descriptor.capability_id != CAPABILITY_DISCOVER_TOOL_ID
            and ceiling_allows(self._profile.capability_ceiling, descriptor.capability_id)
        )

    async def _promote(
        self,
        descriptors: Sequence[CapabilityDescriptor],
        snapshot: AgentLoopSnapshot,
    ) -> tuple[tuple[str, ...], tuple[str, ...]]:
        promoted: list[str] = []
        skipped: list[str] = []
        async with self._lock:
            changed = False
            for descriptor in descriptors:
                capability_id = descriptor.capability_id
                if capability_id in self._tools:
                    promoted.append(capability_id)
                    continue
                size = len(json.dumps(dict(descriptor.parameter_schema), ensure_ascii=False).encode("utf-8"))
                if self._promoted_schema_bytes + size > MAX_PROMOTED_SCHEMA_BYTES:
                    skipped.append(capability_id)
                    continue
                self._promoted_schema_bytes += size
                self._tools[capability_id] = self._bind_capability(descriptor)
                promoted.append(capability_id)
                changed = True
            if changed:
                self._revision += 1
        return tuple(promoted), tuple(skipped)

    def _bind_capability(self, descriptor: CapabilityDescriptor) -> BoundAgentTool:
        async def invoke(call: CapabilityCall, snapshot: AgentLoopSnapshot) -> Observation:
            if not ceiling_allows(self._profile.capability_ceiling, call.capability):
                return _failed_observation(
                    call,
                    f"Profile {self._profile.profile_id!r} does not authorize {call.capability!r}.",
                )
            return await self._invoker.invoke(
                self._run,
                call,
                AgentInvocationContext(
                    profile_id=self._profile.profile_id,
                    step=snapshot.turn,
                    policies=self._profile.invocation_policies,
                    history=snapshot.history,
                ),
            )

        return BoundAgentTool(
            descriptor=AgentToolDescriptor(
                tool_id=descriptor.capability_id,
                description=descriptor.description,
                parameter_schema=descriptor.parameter_schema,
            ),
            invoke=invoke,
        )


def _filters(call: CapabilityCall) -> tuple[tuple[str, ...], tuple[str, ...]] | str:
    raw_providers = call.args.get("providers") or []
    raw_selectors = call.args.get("selectors") or []
    if not isinstance(raw_providers, list) or not isinstance(raw_selectors, list):
        return "providers and selectors must be arrays."
    try:
        selectors = tuple(dict.fromkeys(normalize_capability_selector(str(value)) for value in raw_selectors))
    except ValueError as exc:
        return str(exc)
    providers = tuple(dict.fromkeys(str(value).strip() for value in raw_providers if str(value).strip()))
    return providers, selectors


def _rank_descriptors(query: str, descriptors: Sequence[CapabilityDescriptor]) -> tuple[CapabilityDescriptor, ...]:
    query_terms = _tokens(query)
    if not query_terms:
        return tuple(sorted(descriptors, key=lambda item: item.capability_id))
    documents = [_weighted_terms(descriptor) for descriptor in descriptors]
    average_length = sum(len(document) for document in documents) / max(1, len(documents))
    document_frequency = Counter(term for term in query_terms if any(term in document for document in documents))

    def score(index: int) -> float:
        document = documents[index]
        frequencies = Counter(document)
        value = 0.0
        for term in query_terms:
            frequency = frequencies[term]
            if not frequency:
                continue
            frequency_docs = document_frequency[term]
            inverse_frequency = math.log(1 + (len(documents) - frequency_docs + 0.5) / (frequency_docs + 0.5))
            denominator = frequency + 1.5 * (1 - 0.75 + 0.75 * len(document) / max(1.0, average_length))
            value += inverse_frequency * frequency * 2.5 / denominator
        normalized_query = query.casefold().strip().replace(".", ":")
        if normalized_query == descriptors[index].capability_id:
            value += 100.0
        return value

    ranked = sorted(range(len(descriptors)), key=lambda index: (-score(index), descriptors[index].capability_id))
    return tuple(descriptors[index] for index in ranked)


def _weighted_terms(descriptor: CapabilityDescriptor) -> tuple[str, ...]:
    identifier = _tokens(descriptor.capability_id)
    usage = _tokens(descriptor.when_to_use)
    description = _tokens(descriptor.description)
    sandbox = _tokens(" ".join(descriptor.required_sandbox))
    return (*identifier, *identifier, *identifier, *identifier, *usage, *usage, *description, *sandbox)


def _tokens(value: str) -> tuple[str, ...]:
    return tuple(_SEARCH_TOKEN_PATTERN.findall(value.casefold()))


def _encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(str(offset).encode("ascii")).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> int:
    if not cursor:
        return 0
    padding = "=" * (-len(cursor) % 4)
    return int(base64.urlsafe_b64decode(cursor + padding).decode("ascii"))


def _compact_payload(descriptor: CapabilityDescriptor) -> dict[str, object]:
    return {
        "capability_id": descriptor.capability_id,
        "description": descriptor.description,
        "when_to_use": descriptor.when_to_use,
        "effect": descriptor.effect,
        "workspace_access": descriptor.workspace_access,
        "required_sandbox": list(descriptor.required_sandbox),
    }


def _successful_observation(call: CapabilityCall, payload: dict[str, object], summary: str) -> Observation:
    return Observation(
        capability=call.capability,
        call_id=call.call_id,
        ok=True,
        status="completed",
        summary=summary,
        content=json.dumps(payload, ensure_ascii=False),
    )


def _failed_observation(call: CapabilityCall, message: str) -> Observation:
    return Observation(
        capability=call.capability,
        call_id=call.call_id,
        ok=False,
        status="failed",
        summary=message,
        content=message,
        error_class=ErrorClass.POLICY_DENY.value,
        error_message=message,
    )
