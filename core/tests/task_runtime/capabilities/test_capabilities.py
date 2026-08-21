"""Contract tests for the capability layer.

The descriptor fixtures below are the ones from
``docs/agent-routing-capability-fixtures.md``, promoted from a paper checklist
into a regression guard: a GUI action set and a remote (MCP-style) tool must
stay expressible without adding a field or granting either shape a special case.
"""

from __future__ import annotations

import pytest

from app.biz.task_runtime.capabilities.catalogue import builtin_descriptors, skill_descriptors
from app.biz.task_runtime.capabilities.descriptors import (
    CapabilityBinding,
    CapabilityDescriptor,
    CatalogueQuery,
    ResolveContext,
    sensitive_parameter_names,
    split_sensitive_arguments,
)
from app.biz.task_runtime.capabilities.ids import (
    builtin_tool_of,
    normalize_capability_id,
    skill_action_of,
    split_capability_id,
)
from app.biz.task_runtime.capabilities.resolver import CapabilityResolver
from app.biz.task_runtime.capabilities.loader import CapabilityCard
from app.biz.task_runtime.capabilities.tool_catalog import RUNTIME_TOOLS


# ---------------------------------------------------------------------------
# Capability ids
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("echo", "builtin:echo"),
        ("android-tester.run", "skill:android-tester.run"),
        ("builtin:echo", "builtin:echo"),
        ("gui.android:tap", "gui.android:tap"),
        ("", ""),
    ],
)
def test_normalize_capability_id_maps_legacy_spellings(raw: str, expected: str) -> None:
    assert normalize_capability_id(raw) == expected


def test_split_capability_id_splits_on_the_first_separator_only() -> None:
    # A provider id may be dotted and a local name may contain dots, so only the
    # first separator can be the boundary.
    assert split_capability_id("gui.android:tap") == ("gui.android", "tap")
    assert split_capability_id("skill:android-tester.run") == ("skill", "android-tester.run")


def test_capability_id_decomposition_is_provider_scoped() -> None:
    assert skill_action_of("skill:android-tester.run") == ("android-tester", "run")
    assert skill_action_of("builtin:echo") == ("", "")
    assert builtin_tool_of("builtin:echo") == "echo"
    assert builtin_tool_of("skill:android-tester.run") == ""


# ---------------------------------------------------------------------------
# Descriptor fixtures (docs/agent-routing-capability-fixtures.md)
# ---------------------------------------------------------------------------


def _gui_observe() -> CapabilityDescriptor:
    return CapabilityDescriptor(
        capability_id="gui.android:observe",
        parameter_schema={"type": "object", "properties": {}, "additionalProperties": False},
        required_sandbox=("android",),
        workspace_access="read_write",  # screenshots / a11y snapshots land in the workspace
        effect="read",
    )


def _gui_tap() -> CapabilityDescriptor:
    return CapabilityDescriptor(
        capability_id="gui.android:tap",
        parameter_schema={
            "type": "object",
            "properties": {"x": {"type": "integer", "minimum": 0}, "y": {"type": "integer", "minimum": 0}},
            "required": ["x", "y"],
            "additionalProperties": False,
        },
        required_sandbox=("android",),
        workspace_access="none",
        effect="mutate",
    )


def _gui_type() -> CapabilityDescriptor:
    return CapabilityDescriptor(
        capability_id="gui.android:type",
        parameter_schema={
            "type": "object",
            "properties": {"content": {"type": "string", "sensitive": True}},
            "required": ["content"],
            "additionalProperties": False,
        },
        required_sandbox=("android",),
        workspace_access="none",
        effect="mutate",
    )


def _gui_file_put() -> CapabilityDescriptor:
    return CapabilityDescriptor(
        capability_id="gui.android:file_put",
        parameter_schema={
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "dest": {"type": "string", "enum": ["Pictures", "Download", "DCIM"]},
            },
            "required": ["source", "dest"],
            "additionalProperties": False,
        },
        required_sandbox=("android",),
        workspace_access="read_only",
        effect="mutate",
    )


def _mcp_search_issues() -> CapabilityDescriptor:
    return CapabilityDescriptor(
        capability_id="mcp.github:search_issues",
        parameter_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
            "required": ["query"],
            "additionalProperties": False,
        },
        required_sandbox=(),  # remote HTTP; no sandbox
        workspace_access="none",
        effect="read",
    )


def test_every_fixture_is_expressible_and_distinctly_named() -> None:
    # The point of the fixtures is that they *construct*: a descriptor missing a
    # field the GUI or a remote source needs would fail right here.
    fixtures = (_gui_observe(), _gui_tap(), _gui_type(), _gui_file_put(), _mcp_search_issues())

    assert len({descriptor.capability_id for descriptor in fixtures}) == len(fixtures)
    assert {descriptor.provider_id for descriptor in fixtures} == {"gui.android", "mcp.github"}


def test_workspace_access_and_effect_are_orthogonal() -> None:
    # ``file_put`` reads the workspace and writes the device; one field cannot
    # express both, which is why they are separate.
    file_put = _gui_file_put()
    assert (file_put.workspace_access, file_put.effect) == ("read_only", "mutate")
    assert file_put.workspace_is_writable is False
    observe = _gui_observe()
    assert (observe.workspace_access, observe.effect) == ("read_write", "read")
    assert observe.workspace_is_writable is True


def test_provider_namespace_is_independent_of_the_local_name() -> None:
    assert _gui_tap().provider_id == "gui.android"


def test_descriptor_requires_an_effect() -> None:
    # No default: "forgot to declare" must fail at assembly, never degrade into
    # "assumed harmless" at runtime.
    with pytest.raises(TypeError):
        CapabilityDescriptor(  # type: ignore[call-arg]
            capability_id="gui.android:tap",
            parameter_schema={},
            required_sandbox=(),
            workspace_access="none",
        )


# ---------------------------------------------------------------------------
# Sensitive parameters
# ---------------------------------------------------------------------------


def test_sensitive_parameters_are_split_out_of_the_persistable_arguments() -> None:
    schema = _gui_type().parameter_schema
    assert sensitive_parameter_names(schema) == frozenset({"content"})

    public, secret = split_sensitive_arguments({"content": "hunter2"}, schema)

    assert public == {"content": "<redacted>"}
    assert secret == {"content": "hunter2"}


def test_arguments_pass_through_when_nothing_is_sensitive() -> None:
    public, secret = split_sensitive_arguments({"x": 1, "y": 2}, _gui_tap().parameter_schema)

    assert public == {"x": 1, "y": 2}
    assert secret == {}


# ---------------------------------------------------------------------------
# Catalogue projections
# ---------------------------------------------------------------------------


def test_builtin_catalogue_is_namespaced_and_complete() -> None:
    descriptors = builtin_descriptors()

    assert {d.capability_id for d in descriptors} == {f"builtin:{tool.name}" for tool in RUNTIME_TOOLS}
    assert all(d.effect in ("read", "mutate") for d in descriptors)


def test_builtin_catalogue_narrows_to_requested_names() -> None:
    assert [d.capability_id for d in builtin_descriptors(["echo"])] == ["builtin:echo"]
    assert [d.capability_id for d in builtin_descriptors(["builtin:echo"])] == ["builtin:echo"]


def test_skill_catalogue_skips_prose_only_cards() -> None:
    executable = CapabilityCard(name="android-tester.run", skill_name="android-tester", action_name="run")
    prose_only = CapabilityCard(name="ppt-designer", skill_name="ppt-designer")

    descriptors = skill_descriptors([executable, prose_only])

    assert [d.capability_id for d in descriptors] == ["skill:android-tester.run"]


def test_undeclared_skill_effect_projects_to_mutate() -> None:
    # Existing skills declare no effect at all; the conservative reading belongs
    # in the projection, never as a descriptor default.
    (descriptor,) = skill_descriptors(
        [CapabilityCard(name="s.a", skill_name="s", action_name="a")],
    )
    assert descriptor.effect == "mutate"

    (declared,) = skill_descriptors(
        [CapabilityCard(name="s.b", skill_name="s", action_name="b", effect="read")],
    )
    assert declared.effect == "read"


def test_skill_parameter_schema_carries_required_and_sensitive_flags() -> None:
    card = CapabilityCard(
        name="s.a",
        skill_name="s",
        action_name="a",
        parameters=[
            {"name": "case_id", "description": "Case id.", "required": True},
            {"name": "password", "sensitive": True},
        ],
    )

    (descriptor,) = skill_descriptors([card])

    assert descriptor.parameter_schema["required"] == ["case_id"]
    assert sensitive_parameter_names(descriptor.parameter_schema) == frozenset({"password"})
    assert descriptor.parameter_schema["properties"]["case_id"]["type"] == "string"
    assert descriptor.parameter_schema["properties"]["password"]["type"] == "string"


def test_skill_parameter_schema_preserves_declared_json_schema_constraints() -> None:
    card = CapabilityCard(
        name="s.a",
        skill_name="s",
        action_name="a",
        parameters=[{"name": "attempt", "type": "integer", "minimum": 1, "maximum": 3}],
    )

    (descriptor,) = skill_descriptors([card])

    assert descriptor.parameter_schema["properties"]["attempt"] == {
        "type": "integer",
        "minimum": 1,
        "maximum": 3,
    }


def test_skill_parameter_schema_preserves_tabular_binding_aliases() -> None:
    card = CapabilityCard(
        name="s.a",
        skill_name="s",
        action_name="a",
        parameters=[
            {
                "name": "username",
                "type": "string",
                "x-sico-binding": {"aliases": ["User Name", "Login"]},
            }
        ],
    )

    (descriptor,) = skill_descriptors([card])

    assert descriptor.parameter_schema["properties"]["username"]["x-sico-binding"] == {
        "aliases": ["User Name", "Login"]
    }


# ---------------------------------------------------------------------------
# Resolver aggregation
# ---------------------------------------------------------------------------


class _StubProvider:
    def __init__(self, provider_id: str, capability_ids: tuple[str, ...] = ()) -> None:
        self.provider_id = provider_id
        self._descriptors = tuple(
            CapabilityDescriptor(
                capability_id=capability_id,
                parameter_schema={},
                required_sandbox=(),
                workspace_access="none",
                effect="read",
            )
            for capability_id in capability_ids
        )

    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        return tuple(d for d in self._descriptors if query.matches(d))

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding | None:
        for descriptor in self._descriptors:
            if descriptor.capability_id == capability_id:
                return CapabilityBinding(descriptor=descriptor, handler=None)  # type: ignore[arg-type]
        return None


class _BrokenProvider(_StubProvider):
    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        raise RuntimeError("catalogue unavailable")

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding | None:
        raise RuntimeError("server unreachable")


def test_duplicate_provider_ids_fail_at_assembly() -> None:
    with pytest.raises(ValueError, match="duplicate capability provider id"):
        CapabilityResolver((_StubProvider("builtin"), _StubProvider("builtin")))


@pytest.mark.asyncio
async def test_resolver_normalizes_before_dispatching_to_a_provider() -> None:
    resolver = CapabilityResolver((_StubProvider("builtin", ("builtin:echo",)),))

    binding = await resolver.resolve("echo", ResolveContext())

    assert binding is not None
    assert binding.descriptor.capability_id == "builtin:echo"


@pytest.mark.asyncio
async def test_unknown_capability_resolves_to_none() -> None:
    resolver = CapabilityResolver((_StubProvider("builtin", ("builtin:echo",)),))

    assert await resolver.resolve("builtin:nope", ResolveContext()) is None
    assert await resolver.resolve("mcp.github:search_issues", ResolveContext()) is None


@pytest.mark.asyncio
async def test_a_failing_provider_does_not_blank_the_catalogue() -> None:
    resolver = CapabilityResolver((_StubProvider("builtin", ("builtin:echo",)), _BrokenProvider("mcp.github", ("mcp.github:x",))))

    descriptors = await resolver.list_descriptors(CatalogueQuery())

    assert [d.capability_id for d in descriptors] == ["builtin:echo"]
    assert await resolver.resolve("mcp.github:x", ResolveContext()) is None


@pytest.mark.asyncio
async def test_catalogue_query_returns_a_subset() -> None:
    resolver = CapabilityResolver((_StubProvider("mcp.github", tuple(f"mcp.github:t{i}" for i in range(50))),))

    limited = await resolver.list_descriptors(CatalogueQuery(limit=5))
    searched = await resolver.list_descriptors(CatalogueQuery(search="t42"))

    assert len(limited) == 5
    assert [d.capability_id for d in searched] == ["mcp.github:t42"]


# ---------------------------------------------------------------------------
# The provider boundary is checked, not trusted
# ---------------------------------------------------------------------------


class _MisbehavingProvider(_StubProvider):
    """Hands back capabilities that are not its own to give."""

    def __init__(self, provider_id: str, foreign: CapabilityDescriptor) -> None:
        super().__init__(provider_id)
        self._foreign = foreign

    async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
        return (self._foreign,)

    async def resolve(self, capability_id: str, context: ResolveContext) -> CapabilityBinding:
        return CapabilityBinding(descriptor=self._foreign, handler=None)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_a_binding_for_another_capability_is_refused() -> None:
    # The descriptor decides the environment and is what the handler runs for,
    # so honouring a mismatched one would execute work nobody asked for.
    foreign = CapabilityDescriptor(
        capability_id="builtin:run_command",
        parameter_schema={},
        required_sandbox=(),
        workspace_access="none",
        effect="mutate",
    )
    resolver = CapabilityResolver((_MisbehavingProvider("builtin", foreign),))

    assert await resolver.resolve("builtin:echo", ResolveContext()) is None


@pytest.mark.asyncio
async def test_catalogue_entries_outside_the_offering_namespace_are_dropped() -> None:
    # Routing sends an id to the provider that owns its namespace, so a foreign
    # entry is unresolvable - offering it to the planner only invites a failure.
    foreign = CapabilityDescriptor(
        capability_id="skill:android-tester.run",
        parameter_schema={},
        required_sandbox=(),
        workspace_access="none",
        effect="read",
    )
    resolver = CapabilityResolver((_MisbehavingProvider("mcp.github", foreign),))

    assert await resolver.list_descriptors(CatalogueQuery()) == ()


@pytest.mark.asyncio
async def test_a_provider_cannot_smuggle_an_internal_capability_into_the_palette() -> None:
    internal = CapabilityDescriptor(
        capability_id="mcp.github:admin_purge",
        parameter_schema={},
        required_sandbox=(),
        workspace_access="none",
        effect="mutate",
        visibility="internal",
    )
    resolver = CapabilityResolver((_MisbehavingProvider("mcp.github", internal),))

    assert await resolver.list_descriptors(CatalogueQuery()) == ()
    assert len(await resolver.list_descriptors(CatalogueQuery(include_internal=True))) == 1


@pytest.mark.parametrize(
    "invalid",
    [
        {"capability_id": "observe"},
        {"capability_id": ""},
        {"parameter_schema": None},
        {"parameter_schema": "{}"},
        {"workspace_access": "teleport"},
        {"effect": "unknown"},
        {"visibility": "secret"},
        {"required_sandbox": ("solaris",)},
    ],
)
def test_a_descriptor_with_an_unusable_field_cannot_be_constructed(invalid: dict) -> None:
    # ``Literal`` binds nothing at runtime. Without this check a visibility of
    # "secret" would slip past the "internal" test and reach the planner as
    # public, an unknown effect would fail open in an effect-based policy, and a
    # non-mapping schema would crash the sensitive-argument split mid-call.
    fields = {
        "capability_id": "gui.android:observe",
        "parameter_schema": {},
        "required_sandbox": (),
        "workspace_access": "none",
        "effect": "read",
        **invalid,
    }
    with pytest.raises(ValueError):
        CapabilityDescriptor(**fields)


@pytest.mark.parametrize("provider_id", ["", "gui:android"])
def test_a_provider_whose_id_is_not_a_usable_namespace_fails_at_assembly(provider_id: str) -> None:
    # The id is the namespace its capabilities are prefixed with, so one that
    # cannot be split back out makes every capability it owns unroutable.
    with pytest.raises(ValueError, match="invalid capability provider id"):
        CapabilityResolver((_StubProvider(provider_id),))


@pytest.mark.asyncio
async def test_the_catalogue_query_carries_the_caller_so_providers_can_scope_it() -> None:
    # A remote source has no other way to tell whose catalogue it is building;
    # without this the planner could only ever see one global palette.
    class _PerCallerProvider(_StubProvider):
        async def list_descriptors(self, query: CatalogueQuery) -> tuple[CapabilityDescriptor, ...]:
            if query.caller.username != "alice@example.com":
                return ()
            return self._descriptors

    resolver = CapabilityResolver((_PerCallerProvider("mcp.github", ("mcp.github:search_issues",)),))

    allowed = await resolver.list_descriptors(CatalogueQuery(caller=ResolveContext(username="alice@example.com")))
    denied = await resolver.list_descriptors(CatalogueQuery(caller=ResolveContext(username="mallory@example.com")))

    assert [d.capability_id for d in allowed] == ["mcp.github:search_issues"]
    assert denied == ()


@pytest.mark.asyncio
async def test_one_malformed_catalogue_entry_costs_only_itself() -> None:
    # The isolation goal is per-provider *and* per-entry: a stray ``None`` in an
    # otherwise usable catalogue must not blank the rest of it.
    class _PartlyBrokenProvider(_StubProvider):
        async def list_descriptors(self, query: CatalogueQuery) -> tuple:
            return (None, *self._descriptors, "not-a-descriptor")

    resolver = CapabilityResolver(
        (
            _PartlyBrokenProvider("mcp.github", ("mcp.github:search_issues",)),
            _StubProvider("builtin", ("builtin:echo",)),
        )
    )

    descriptors = await resolver.list_descriptors(CatalogueQuery())

    assert sorted(d.capability_id for d in descriptors) == ["builtin:echo", "mcp.github:search_issues"]


@pytest.mark.asyncio
async def test_a_catalogue_that_is_not_even_a_sequence_costs_only_its_provider() -> None:
    class _NonsenseProvider(_StubProvider):
        async def list_descriptors(self, query: CatalogueQuery) -> tuple:
            return None  # type: ignore[return-value]

    resolver = CapabilityResolver((_NonsenseProvider("mcp.github"), _StubProvider("builtin", ("builtin:echo",))))

    descriptors = await resolver.list_descriptors(CatalogueQuery())

    assert [d.capability_id for d in descriptors] == ["builtin:echo"]


@pytest.mark.asyncio
async def test_a_binding_that_is_not_a_binding_resolves_to_none() -> None:
    class _NonsenseProvider(_StubProvider):
        async def resolve(self, capability_id: str, context: ResolveContext):
            return "definitely not a binding"

    resolver = CapabilityResolver((_NonsenseProvider("builtin", ("builtin:echo",)),))

    assert await resolver.resolve("builtin:echo", ResolveContext()) is None
