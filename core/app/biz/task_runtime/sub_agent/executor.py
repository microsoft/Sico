"""Host a bounded sub-agent loop inside the durable ``TaskRun`` lifecycle."""

from __future__ import annotations

import asyncio
import logging
import traceback
from dataclasses import dataclass

from ..domain.models import ErrorClass, TaskResult, TaskRun, TaskStatus
from ..guides import SkillGuideRegistry, project_guides_into_workspace, render_activated_guides
from ..storage.run_store import RunStore
from ..domain.time import now_ms as _now_ms
from ..workspace.layout import workspace_layout
from .invoker import CapabilityInvoker
from .loop import (
    AgentContextController,
    AgentLoopEngine,
    AgentLoopLimits,
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentLoopSnapshot,
    AgentTask,
    AgentToolController,
    BoundAgentTool,
    CompletionDirective,
    FinalAnswer,
    LoopFinishedEvent,
    StaticContextController,
    ToolCallRequestedEvent,
    ToolCallCompletedEvent,
)
from .profile import AgentProfile, AgentProfileResolver, CompletionPolicyContext
from .tool_controller import RuntimeAgentToolController
from .loop.transcript import AgentEventTranscript

DEFAULT_MAX_MODEL_TURNS = 32
DEFAULT_STALL_LIMIT = 3
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class AgentExecutorOptions:
    default_max_model_turns: int = DEFAULT_MAX_MODEL_TURNS
    default_max_tool_calls: int | None = None
    stall_limit: int = DEFAULT_STALL_LIMIT
    worker_id: str = "sub-agent-executor"


class SubAgentExecutor:
    """Hosts one framework-neutral agent engine inside the TaskRun lifecycle."""

    def __init__(
        self,
        engine: AgentLoopEngine,
        invoker: CapabilityInvoker,
        *,
        profile_resolver: AgentProfileResolver,
        guide_registry: SkillGuideRegistry | None = None,
        context_controller: AgentContextController | None = None,
        options: AgentExecutorOptions | None = None,
    ) -> None:
        options = options or AgentExecutorOptions()
        self._engine = engine
        self._invoker = invoker
        self._profile_resolver = profile_resolver
        self._guide_registry = guide_registry
        self._context_controller = context_controller or StaticContextController()
        self._default_max_model_turns = options.default_max_model_turns
        self._default_max_tool_calls = options.default_max_tool_calls
        self._stall_limit = max(1, options.stall_limit)
        self._worker_id = options.worker_id

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        token = await store.claim_run(run.run_id, self._worker_id)
        started_at = _now_ms()
        dispatch = run.spec.dispatch

        profile_id = getattr(dispatch, "profile_id", "")
        profile = self._profile_resolver.resolve(profile_id)
        if profile is None:
            result = _failed(run, started_at, ErrorClass.POLICY_DENY, f"Unknown agent profile {profile_id!r}.")
            await store.write_result(run.run_id, result, token)
            return result

        instruction_refs = tuple(getattr(dispatch, "instruction_refs", ()) or ())
        if instruction_refs and self._guide_registry is None:
            result = _failed(run, started_at, ErrorClass.USER_INPUT, "No skill guide registry is configured for this run.")
            await store.write_result(run.run_id, result, token)
            return result
        try:
            guides = tuple(self._guide_registry.resolve(ref) for ref in instruction_refs) if self._guide_registry else ()
            if guides:
                workspace = workspace_layout().workspace_path(
                    run.agent_instance_id,
                    run.username,
                    conversation_id=run.parent_conversation_id,
                )
                guides = project_guides_into_workspace(guides, workspace, run.run_id)
        except ValueError as exc:
            result = _failed(run, started_at, ErrorClass.USER_INPUT, f"Skill guide activation failed: {exc}")
            await store.write_result(run.run_id, result, token)
            return result

        max_model_turns = getattr(dispatch, "max_model_turns", None) or self._default_max_model_turns
        tool_controller = RuntimeAgentToolController(run, profile, self._invoker)
        toolset = await tool_controller.snapshot()
        request = AgentLoopRequest(
            engine_run_id=run.run_id,
            task=AgentTask(
                title=run.spec.title,
                instructions=run.spec.instructions,
                arguments=run.spec.args,
            ),
            system_prompt="\n\n".join(
                section for section in (profile.system_prompt.strip(), render_activated_guides(guides)) if section
            ),
            tools=toolset.descriptors,
            limits=AgentLoopLimits(
                max_model_turns=max_model_turns,
                max_tool_calls=self._default_max_tool_calls,
                allow_parallel_tool_calls=False,
                stall_limit=self._stall_limit,
            ),
        )
        try:
            result = await self._consume_engine(
                run,
                store,
                request,
                toolset.tools,
                tool_controller,
                profile,
                started_at,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any loop fault as a failed run.
            result = _failed_from_exception(run, started_at, "Sub-agent loop crashed", exc)
        await store.write_result(run.run_id, result, token)
        return result

    async def _consume_engine(
        self,
        run: TaskRun,
        store: RunStore,
        request: AgentLoopRequest,
        tools: tuple[BoundAgentTool, ...],
        tool_controller: AgentToolController,
        profile: AgentProfile,
        started_at: int,
    ) -> TaskResult:
        async def evaluate_completion(
            proposal: FinalAnswer,
            snapshot: AgentLoopSnapshot,
        ) -> CompletionDirective:
            decision = await profile.completion_policy.evaluate(
                CompletionPolicyContext(
                    run=run,
                    profile_id=profile.profile_id,
                    step=snapshot.turn,
                    history=snapshot.history,
                ),
                proposal,
            )
            return CompletionDirective(outcome=decision.outcome, reason=decision.reason)

        runtime = AgentLoopRuntime(
            context_controller=self._context_controller,
            evaluate_completion=evaluate_completion,
            tool_controller=tool_controller,
        )
        finished: LoopFinishedEvent | None = None
        child_run_ids: list[str] = []
        transcript = AgentEventTranscript(_event_transcript_path(run))
        await _reset_event_transcript(transcript)
        try:
            async for event in self._engine.run(
                request,
                tools=tools,
                runtime=runtime,
            ):
                await _append_event_transcript(transcript, event, run.run_id)
                if isinstance(event, ToolCallRequestedEvent):
                    await store.set_progress(run.run_id, f"step {event.turn}: {event.call.capability}", ts=_now_ms())
                elif isinstance(event, ToolCallCompletedEvent) and event.observation.run_id:
                    child_run_ids.append(event.observation.run_id)
                elif isinstance(event, LoopFinishedEvent):
                    finished = event
        finally:
            await _flush_event_transcript(transcript, run.run_id)
        if finished is None:
            return _failed(run, started_at, ErrorClass.INTERNAL, "Agent loop ended without a terminal event.")
        result = _result_from_loop(run, started_at, finished)
        return await _promote_child_artifacts(result, store, child_run_ids)

async def _promote_child_artifacts(result: TaskResult, store: RunStore, child_run_ids: list[str]) -> TaskResult:
    artifacts = []
    seen_uris: set[str] = set()
    for child_run_id in dict.fromkeys(child_run_ids):
        try:
            detail = await store.get_task_detail(child_run_id, "artifacts")
        except (FileNotFoundError, ValueError):
            continue
        if detail.result is None:
            continue
        for artifact in detail.result.artifacts:
            if artifact.uri in seen_uris:
                continue
            seen_uris.add(artifact.uri)
            artifacts.append(artifact)
    if not artifacts:
        return result
    return result.model_copy(update={"primary_artifact": artifacts[0], "artifacts": artifacts})


def _event_transcript_path(run: TaskRun):
    workspace = workspace_layout().workspace_path(
        run.agent_instance_id,
        run.username,
        conversation_id=run.parent_conversation_id,
    )
    return workspace / "results" / run.batch_id / run.run_id / f"attempt-{run.attempt}" / "events.jsonl"


async def _reset_event_transcript(transcript: AgentEventTranscript) -> None:
    try:
        await transcript.reset()
    except Exception:  # noqa: BLE001 - diagnostic persistence must not fail task execution.
        _LOGGER.warning("sub_agent_event_transcript_reset_failed path=%s", transcript.path, exc_info=True)


async def _append_event_transcript(transcript: AgentEventTranscript, event, run_id: str) -> None:
    try:
        await transcript.append(event)
    except Exception:  # noqa: BLE001 - diagnostic persistence must not fail task execution.
        _LOGGER.warning("sub_agent_event_transcript_append_failed run_id=%s path=%s", run_id, transcript.path, exc_info=True)


async def _flush_event_transcript(transcript: AgentEventTranscript, run_id: str) -> None:
    try:
        await transcript.flush()
    except Exception:  # noqa: BLE001 - diagnostic persistence must not fail task execution.
        _LOGGER.warning("sub_agent_event_transcript_flush_failed run_id=%s path=%s", run_id, transcript.path, exc_info=True)


def _result_from_loop(run: TaskRun, started_at: int, finished: LoopFinishedEvent) -> TaskResult:
    metrics = {
        "model_turns": finished.model_turns,
        "tool_calls": finished.tool_calls,
        "input_tokens": finished.usage.input_tokens,
        "output_tokens": finished.usage.output_tokens,
        "total_tokens": finished.usage.total_tokens,
        "cached_input_tokens": finished.usage.cached_input_tokens,
        "reasoning_tokens": finished.usage.reasoning_tokens,
    }
    if finished.outcome == "completed":
        return _completed(run, started_at, finished.summary, finished.output, metrics)
    error_class = {
        "policy_denied": ErrorClass.POLICY_DENY,
        "transient": ErrorClass.TRANSIENT,
    }.get(finished.error_kind, ErrorClass.INTERNAL)
    return _failed(run, started_at, error_class, finished.summary, metrics)


def _completed(
    run: TaskRun,
    started_at: int,
    summary: str,
    output: str,
    metrics: dict[str, int] | None = None,
) -> TaskResult:
    ended_at = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary=summary or "Sub-agent completed.",
        output=output or summary,
        sandbox=run.sandbox,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - started_at),
        metrics=metrics or {},
    )


def _failed(
    run: TaskRun,
    started_at: int,
    error_class: ErrorClass,
    message: str,
    metrics: dict[str, int] | None = None,
) -> TaskResult:
    ended_at = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=error_class,
        error_message=message,
        sandbox=run.sandbox,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - started_at),
        metrics=metrics or {},
    )


def _failed_from_exception(run: TaskRun, started_at: int, prefix: str, exc: Exception) -> TaskResult:
    summary = f"{prefix}: {exc}"
    traceback_text = "".join(traceback.format_exception(exc)).strip()
    sections = [summary, traceback_text]
    for stream_name in ("stdout", "stderr"):
        stream = getattr(exc, stream_name, None)
        if isinstance(stream, bytes):
            stream = stream.decode(errors="replace")
        if isinstance(stream, str) and stream.strip():
            sections.append(f"{stream_name}:\n{stream.strip()}")
    detail = "\n\n".join(sections)
    result = _failed(run, started_at, ErrorClass.INTERNAL, detail)
    return result.model_copy(update={"summary": summary, "output": detail})
