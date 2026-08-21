"""Capability layer: one concept for every executable thing the runtime dispatches.

Import from the concrete modules rather than this package:

- :mod:`.ids` — pure capability identifier construction and parsing.
- :mod:`.descriptors` — the descriptor, binding, handler, and provider contracts.
- :mod:`.catalogue` — pure source-metadata → descriptor projections, shared by
  the planner and the runtime.
- :mod:`.resolver` — the aggregate over providers.
- :mod:`.builtin` / :mod:`.skill` — the concrete providers. These pull in the
  execution stack, which is exactly why this package re-exports nothing: a
  package-level import would drag that stack into everything that only needs the
  contract.
"""
