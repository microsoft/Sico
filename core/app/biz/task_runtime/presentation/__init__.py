"""Presentation-layer adapters for task_runtime: plan mirroring and rendering.

This package is the impure boundary that may import ``app.schemas`` and write
to the chat ``PlanEditor``. The runtime **lifecycle** modules (scheduler,
coordinators, result finalizer) depend only on the neutral seam
(:mod:`.port` / :mod:`.events`) and the concrete sink is
wired in at the composition root (:mod:`..manager`). The **plan-creation /
recovery** modules (:mod:`..orchestration.submitter`, :mod:`..orchestration.recovery`) still import
rendering helpers directly, since building the initial plan / recovery messages
is itself schema-coupled work; tightening that edge is deferred future work.
"""
