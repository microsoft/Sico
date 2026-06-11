# ToolCall rendering contract

This document is the cross-team contract between the **core** task runtime
(producer) and the **frontend** chat UI (consumer) for how an agent tool call is
rendered. It exists so the frontend can render purely from **structured fields**
and the runtime can stop composing human prose into `message`.

- Schema source of truth: [`core/app/schemas/conversation/plan.py`](../../core/app/schemas/conversation/plan.py)
  (`ToolCall` and friends), generated from
  [`proto/conversation/plan.proto`](../../proto/conversation) via betterproto2.
- Reference renderer: [`reference_renderer.html`](reference_renderer.html) — open
  it in a browser and load any example to see the intended rendering.
- Canonical examples: [`examples/`](examples) — also used by the contract test
  `core/tests/task_runtime/test_rendering_contract.py`.

## Wire format

A `ToolCall` crosses the wire as proto3-JSON:

- Keys are **camelCase** (e.g. `toolName`, `runningList`, `toolCallStatus`).
- Enums may appear as their integer value or their proto name; the reference
  renderer accepts both. The tables below list both.
- Unknown/empty fields default to empty string / empty list / `0` and should
  render as "absent".

## `ToolCall`

| Field (camelCase) | Type | Rendering rule |
| --- | --- | --- |
| `toolName` | string | Card title / header label. |
| `toolCallStatus` | enum (see below) | Status badge on the card header; drives color/icon. |
| `runningList` | `RunningListItem[]` | Ordered **stage timeline**. Render top-to-bottom, one row per item with a per-item status icon. This is the primary progress UI. |
| `executionInfo` | `ExecutionInfo` | Secondary label (which builtin tool ran). |
| `deliverables` | `Deliverable[]` | Result cards rendered **below** the timeline (see types below). |
| `display` | `map<string,string>` | Supplementary key/value labels (e.g. `latest_progress`). Render as a compact key/value list. Keys are stable identifiers, values are display text. |
| `batchCalls` | `ToolCall[]` | Child tool calls of a batch. Render each as a **nested** ToolCall card, ordered by `batchItemIndex`. |
| `batchItemIndex` | int | Position of this call inside its parent batch (0-based). |
| `toolCallId` | int | Stable id for incremental updates (streaming patches target this id). |
| `message` | string | **DEPRECATED legacy prose markdown.** Do **not** parse for status/outcome. Render at most inside a collapsed "details" affordance, or ignore. Everything here is also available structurally. |

### `toolCallStatus` (enum `ToolCallStatus`)

| Value | Name | Meaning / suggested rendering |
| --- | --- | --- |
| 0 | `UNKNOWN` | Neutral / no badge. |
| 1 | `RUNNING` | In progress (spinner, blue). |
| 2 | `FAILED` | Failed (red). |
| 3 | `SUCCESSFUL` | Succeeded (green). |
| 4 | `FAILED_ANALYZING` | Failed, root-cause analysis in progress. |
| 5 | `FAILED_ANALYZED` | Failed, analysis attached (see deliverables). |
| 6 | `RETRY_RUNNING` | Retrying (blue, "retry" marker). |
| 7 | `RETRY_SUCCESSFUL` | Succeeded after retry (green, "retry" marker). |
| 8 | `RETRY_FAILED` | Failed after retry (red, "retry" marker). |

## `RunningListItem` (stage timeline row)

| Field | Type | Rendering rule |
| --- | --- | --- |
| `name` | string | Human-readable stage label (already localized text). Render verbatim. |
| `status` | enum (below) | Per-row icon. |

### `RunningListItem.status` (enum `ToolCallRunningListItemStatus`)

| Value | Name | Suggested icon |
| --- | --- | --- |
| 0 | `UNKNOWN` | — |
| 1 | `PENDING` | hollow / clock |
| 2 | `RUNNING` | spinner |
| 3 | `DONE` | check |
| 4 | `FAILED` | cross |
| 5 | `CANCELLED` | minus / strikethrough |

Typical single-run stage keys emitted by the runtime (label text varies):
`plan` → `workspace` → (`sandbox`) → `execute` → (`upload`) → (`release`).
Batch parents add stages such as preparation, concurrency ordering, runner
selection, per-group progress, execution, and finalization.

## `Deliverable`

| Field | Type | Rendering rule |
| --- | --- | --- |
| `type` | enum (below) | Selects the renderer for this deliverable. |
| `markdownTitle` | string | Optional heading for a markdown deliverable. |
| `markdownContent` | string | Markdown body (render as markdown). |
| `fileName` | string | Display name for a file deliverable. |
| `fileUrl` | string | Download URL for a file deliverable. |
| `webPreviewSasUrl` | string | URL to embed/preview (e.g. an HTML report). |
| `acquiredSandbox` | `AcquiredSandbox` | Live sandbox card (see below). |

### `Deliverable.type` (enum `ToolDeliverableType`)

| Value | Name | Rendering |
| --- | --- | --- |
| 0 | `UNKNOWN` | ignore |
| 1 | `MARKDOWN` | render `markdownTitle` + `markdownContent` as markdown |
| 2 | `FILE` | download chip: `fileName` linking to `fileUrl` |
| 3 | `WEB_PREVIEW_URL` | embed/preview `webPreviewSasUrl` (iframe or "open preview") |
| 5 | `ACQUIRED_SANDBOX` | render `acquiredSandbox` as a live device card |

### `AcquiredSandbox`

| Field | Type | Rendering rule |
| --- | --- | --- |
| `sandboxId` | string | Internal id (secondary text). |
| `sandboxType` | string | e.g. `android`. |
| `displayName` | string | Card title. |
| `endpoint` | string | Service endpoint (secondary). |
| `providerBaseUrl` | string | Provider base URL (secondary). |
| `deviceId` | string | Device id (secondary). |
| `vncUrl` | string | Link/embed for interactive view. |

## `ExecutionInfo`

| Field | Type | Rendering rule |
| --- | --- | --- |
| `toolType` | enum `ToolType` (`0 UNKNOWN`, `1 BUILTIN`) | Categorization. |
| `builtinToolName` | string | Secondary label, e.g. `run_python`. |

### Batch umbrella node naming

A delegated batch is rendered as a parent ("umbrella") `ToolCall` whose
`batchCalls` are the per-task children. The umbrella node carries a
**runtime-owned, neutral** identity that does not leak the chat-side adapter
selection (the `delegate` tool's `kind`, e.g. `general`, `workbook`, …):

- `toolName` is `run_task` for a single-task batch and `run_tasks` for a
  multi-task batch.
- `executionInfo.builtinToolName` is always `run_tasks`.

Each child in `batchCalls` keeps its own per-task tool name (e.g. `android_task`,
`run_python`, `run_command`). See
[`examples/batch_with_sandbox.json`](examples/batch_with_sandbox.json) for the
parent `run_tasks` node wrapping `android_task` children. The frontend maps the
machine id (`run_tasks`) to a human label.

## Migration note (why `message` is deprecated)

Historically the runtime composed human-readable markdown into `message`
(see `core/app/biz/task_runtime/rendering/`). The frontend then parsed that
prose. Every fact in `message` is now also exposed structurally:

- progress timeline → `runningList`
- pass/fail/retry outcome → `toolCallStatus`
- artifacts / reports / sandboxes → `deliverables`
- supplementary labels → `display`

Once the frontend renders exclusively from the structured fields, the runtime
will stop populating `message` and the `rendering/` prose composers can be
removed. **New frontend code must not depend on `message`.**

The canonical examples under [`examples/`](examples) still carry a `message`
field on purpose — they double as a sample of the legacy wire form. Do not copy
that prose into the renderer. The contract test
(`core/tests/task_runtime/test_rendering_contract.py`) strips `message`
recursively and asserts every example still validates and renders from the
structured fields alone, so "ignore `message`" is enforced, not just advised.
