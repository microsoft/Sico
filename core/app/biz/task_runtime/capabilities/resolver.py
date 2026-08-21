"""The aggregate over every capability source.

:class:`CapabilityResolver` exposes the same two entry points a provider does —
*list descriptors* while planning, *resolve a binding* while executing — so
composing sources adds no second kind of thing. It deliberately owns no run
lifecycle.

Two failure modes are handled differently on purpose. A provider-id collision is
a wiring mistake and fails loudly at assembly time; an unknown capability at
execution time fails closed as a normal task failure, because the catalogue can
legitimately shrink between planning and execution.

A provider is an extension point, so what it hands back is *checked*, not
trusted: a binding must describe the capability that was asked for, and a
catalogue entry must belong to the offering provider and still satisfy the
query. Without that, one buggy source could have the runtime execute — or the
planner offer — a different capability entirely.
"""

from __future__ import annotations

import logging

from .descriptors import (
    CapabilityBinding,
    CapabilityDescriptor,
    CapabilityProvider,
    CatalogueQuery,
    ResolveContext,
)
from .ids import CAPABILITY_ID_SEPARATOR, normalize_capability_id, provider_of

_LOGGER = logging.getLogger(__name__)


class CapabilityResolver:
    """Aggregates capability providers behind the provider interface."""

    def __init__(self, providers: tuple[CapabilityProvider, ...] | list[CapabilityProvider]) -> None:
        by_id: dict[str, CapabilityProvider] = {}
        for provider in providers:
            provider_id = provider.provider_id
            if not provider_id or CAPABILITY_ID_SEPARATOR in provider_id:
                # The id is the namespace every capability of this provider is
                # prefixed with, so one that cannot be split back out would make
                # every capability it owns unroutable.
                raise ValueError(f"invalid capability provider id {provider_id!r} ({type(provider).__name__})")
            existing = by_id.get(provider_id)
            if existing is not None:
                raise ValueError(
                    f"duplicate capability provider id {provider_id!r} ({type(existing).__name__} vs {type(provider).__name__})"
                )
            by_id[provider_id] = provider
        self._providers = by_id

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding | None:
        normalized = normalize_capability_id(capability_id)
        provider = self._providers.get(provider_of(normalized))
        if provider is None:
            return None
        try:
            binding = await provider.resolve(normalized, context)
        except Exception:  # noqa: BLE001 - a provider fault is an unresolved capability, not a crash.
            _LOGGER.warning("capability_resolve_failed capability_id=%s", normalized, exc_info=True)
            return None
        if binding is None:
            return None
        if not isinstance(binding, CapabilityBinding) or binding.descriptor.capability_id != normalized:
            # The descriptor decides the environment and is what the handler is
            # invoked for, so a mismatch would run something nobody asked for.
            _LOGGER.warning("capability_binding_rejected capability_id=%s returned=%r", normalized, binding)
            return None
        return binding

    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        descriptors: list[CapabilityDescriptor] = []
        for provider_id, provider in self._providers.items():
            if query.providers and provider_id not in query.providers:
                continue
            try:
                # Vetting is inside the guard on purpose: a provider that returns
                # something other than a sequence of descriptors must cost only
                # its own entries, not the whole catalogue.
                offered = list(await provider.list_descriptors(query))
                descriptors.extend(_vetted(provider_id, offered, query))
            except Exception:  # noqa: BLE001 - one broken source must not blank the whole catalogue.
                _LOGGER.warning("capability_catalogue_failed provider_id=%s", provider_id, exc_info=True)
        if query.limit is not None and query.limit >= 0:
            descriptors = descriptors[: query.limit]
        return tuple(descriptors)


def _vetted(
    provider_id: str,
    offered: list[CapabilityDescriptor],
    query: CatalogueQuery,
) -> list[CapabilityDescriptor]:
    """Drop catalogue entries a provider should not have offered.

    An entry outside the provider's own namespace would be unresolvable (routing
    sends its id elsewhere), and one the query excluded — an ``internal``
    capability above all — would reach the planner as a pickable option.
    """
    kept = [d for d in offered if isinstance(d, CapabilityDescriptor) and d.provider_id == provider_id and query.matches(d)]
    if len(kept) != len(offered):
        # One line per call, not per entry: a provider that offers hundreds of
        # bad descriptors would otherwise flood the log on every planner turn.
        _LOGGER.warning(
            "capability_catalogue_rejected provider_id=%s rejected=%d offered=%d",
            provider_id,
            len(offered) - len(kept),
            len(offered),
        )
    return kept
