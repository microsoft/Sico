# Chat Agent Tools

Sico's chat agent receives a different tool set depending on the **route** chosen for the turn. A hard guard plus an LLM intent checker classify each turn into one of two routes (`fast`, `task`); the route then determines which tools the agent is given.

Route classification lives in `core/app/biz/chat/router.py` (a chain of `ChatRouter` stages), and its keyword rules in `core/app/biz/chat/route_rules.toml`. Tool selection lives in `core/app/biz/chat/tool_registry.py`: `CHAT_TOOLS` is the chat agent's tool surface — an explicit allow-list — and a route either receives it whole or receives nothing. `delegate` is on no list because it has no static instance; the chat service builds one `DelegatePreparationService` and one `build_delegate_tool(...)` each turn for routes that may delegate.

## Routes

| Route | Purpose | Tools exposed |
|---|---|---|
| `fast` | Direct answer mode. No tools. | none |
| `task` | Everything else, including read-only questions about existing context. | `context`, `read`, `grep`, `parse_document`, `search_memory`, `get_task_detail`, `write_file`, `edit`, `remove`, `report`, `plan_read`, `plan_write`, `plan_tool_call_message_update`, `webfetch`, `web_search`, `curl`, `download`, and a single `delegate(request_json)` tool for mixed instruction/tabular sources |

There is no read-only middle route. It differed from `task` by five tools, and "read-only" is not a stable user intent — answering "what did the last run do" can legitimately need `parse_document` or `curl`. Misrouting into it cost a whole wasted turn, so the classification decision was removed rather than tuned.

The "real work" of durable execution is intentionally funneled through the `delegate` tool on the `task` route. `run_command`, `invoke_skill`, and the `sandbox_*` lifecycle tools are **not** wired as direct chat tools — each `delegate` call owns task scheduling, sandbox lifecycle, retries, and result summaries end to end.

## Summary

| Tool | What it does | Typical use |
|---|---|---|
| `context` | Lists visible workspace files, skill summaries, and knowledge summaries. | Discover what files, skills, attachments, and knowledge are available. |
| `read` | Reads a workspace-relative text file with line limits. | Inspect exact files after `context` or a known path. |
| `grep` | Searches workspace files with a regex. | Locate content without loading large files. |
| `parse_document` | Parses a current-turn attachment under `attachments/**` or downloaded file under `download/**`. | Extract text/tables from PDF, DOCX, PPTX, XLSX, and similar documents. |
| `search_memory` | Retrieves related memories for the user/agent. | Reuse learned preferences or prior operational knowledge. |
| `get_task_detail` | Fetches a delegated run's summary or artifact list by `run_id`. | Answer follow-ups the batch digest does not cover. |
| `write_file` | Writes a file into the workspace. | Create scripts, data files, notes, or generated artifacts. |
| `edit` | Replaces text in an existing workspace file. | Patch a generated script or document. |
| `remove` | Deletes a workspace file or directory. | Clean obsolete workspace artifacts. |
| `report` | Uploads turn report files or workspace-local files and returns shareable URLs. | Publish final reports or user-requested local artifacts. |
| `plan_read` | Reads the current turn plan. | Check task progress before modifying it. |
| `plan_write` | Writes the full current turn plan. | Create/update visible execution steps. |
| `plan_tool_call_message_update` | Updates an existing tool-call message. | Refine displayed tool progress. |
| `webfetch` | Fetches public web page content as Markdown-like text. | Read documentation or information pages. |
| `curl` | Runs a `curl` command with standard curl flags. | Call HTTP APIs, inspect headers/status, or use authenticated requests when credentials are handled externally. |
| `download` | Downloads a public direct-file URL into the workspace and extracts supported document content. | Bring a public PDF/DOCX/XLSX into the workspace. |
| `web_search` | Server-side grounded search run by the model provider; declaring the spec routes the turn to the Responses API. | Answer questions about current, live or fast-changing facts. |
| `delegate` | Accepts one `request_json` containing mixed instruction and tabular sources. It submits a task batch only after preparation succeeds; otherwise it returns structured clarification, rejection, or operational-failure details. | Run durable skill/tool jobs, especially Android test cases or tabular batches. |

## Workspace Visibility

The agent's active workspace is intended for current inputs, skill cortex files, knowledge snapshots, attachments, and files intentionally created during the current turn.

Historical turn archives and direct skill results are intentionally not LLM-visible workspace context:

- Full turn history is not copied into the active workspace; at most three recent turns containing compact `rerun_sources/` artifacts are projected under hidden `history/` storage.
- `.results/` is removed from the active workspace during workspace init.
- `context` hides stale `history/` and `.results/` directories if they already exist.
- Direct `invoke_skill` output is stored under turn-scoped storage such as `turn/{turn_id}/results/skills/{skill_id}/{run_id}/`.

This keeps old reports and historical conversations from distracting the model. Historical case sources and rerun payloads remain archived under turn storage and are surfaced through bounded source-resolution prompts when relevant.

Current tabular attachments and staged Knowledge are indexed before routing into a conversation-private content-addressed repository outside the active workspace. The repository is shared by chat context, `parse_document`, and delegate preparation. Its active-ref catalogue lists only currently available logical refs; Knowledge refs removed from the next authorized staging set disappear immediately even though immutable objects may remain during cleanup grace. Object retention alone is not rerun authorization: a compact rerun requires an active logical attachment/Knowledge ref whose content hash still matches the original task. The live workspace file may be absent because preparation can rematerialize the matching snapshot object. Generic file tools and general workspace mounts cannot access the repository. Only Source Domain services read manifests and typed snapshots directly. Preparation records a stable `sico-source://` reference for the selected object; runtime revalidates its hash, replaces the URI only in the execution context, and mounts that object read-only only when a task argument actually uses the URI. Callers cannot use the URI as a logical `source_ref`. Manifests expose bounded sheets, headers, case IDs, row counts, runnable status, and semantic kind so the TASK agent can request missing scope before delegation.

## Delegation

The `delegate` tool is the chat agent's way to run durable, scheduled, retried, and summarized work. One `request_json` may contain several instruction groups and several tabular documents, all submitted as one batch after preparation succeeds.

The tool takes one `request_json` string. The decoded object looks like:

```json
{
  "sources": [
    {
      "type": "instructions",
      "capability_ids": ["builtin:echo"],
      "items": [
        {"goal": "Emit the start marker", "capability_id": "builtin:echo", "params": {"message": "start"}}
      ]
    },
    {
      "type": "tabular",
      "documents": [
        {"source_ref": "attachments/cases.xlsx", "sheet_names": ["Cases"]},
        {"source_ref": "attachments/regression.csv"}
      ],
      "capability_ids": ["skill:android-tester.run_android_test_case"]
    }
  ],
  "batch_goal": "Run both test sources and summarize the result",
  "join_strategy": "all_success",
  "max_concurrency": 4
}
```

Instruction items become neutral work items. Tabular sources select typed rows from canonical snapshots; testcase/generic recognition is source metadata, while execution capability candidates and optional parameter bindings remain explicit and auditable. All required bindings and every selected row are validated before any runtime row is created.

Tabular results carry bounded reporting context from each selected executable skill. Single-skill batches preserve `additional_info.skill_description`; mixed-capability batches expose a deduplicated `additional_info.skill_descriptions` list.

A request may select at most **500 total work items** across instruction items and tabular rows. Request-shape limits fail during JSON validation; rows are streamed and selected-row overflow returns a structured clarification before any planner call or runtime submission. Exact case IDs may be found beyond the first 500 source rows because only matching rows consume the work-item budget.

At most **100 unresolved instruction items** and **500 KB of planner context** may enter one shared task-planner call. Larger scopes return `task_planner_scope_limit`; explicitly prebound instruction items still count toward the 500-task batch limit but do not consume the unresolved-item limit.

Multi-task results use a compact digest: at most 10 detailed results and 50 inline report/artifact URLs. Counts, `artifacts_root`, omitted URL counts, and bounded omitted success/non-success run IDs remain available so the agent can recover any listed run through `get_task_detail`.

## Android Test Case Example

A good end-to-end Android test-case turn usually looks like this:

1. Inspect available capability cards.

   The agent receives the capability section in the user prompt. If it needs a refresh, it may call `context` to inspect visible workspace skills. For Android testing, it should look for a skill action with `infra_requirements: ["sandbox.android"]`, such as `android-tester.run_android_test_case`.

2. Create or update the visible plan.

   ```json
   {
     "title": "Run Android Edge workflow",
     "items": [
       {"title": "Submit Android UI test run", "status": "in_progress"},
       {"title": "Review execution result", "status": "pending"}
     ]
   }
   ```

3. Use one `delegate(request_json)` call for the actual run, including every related instruction and file source.

  The model should provide complete instructions and let preparation use the visible capability/profile catalogues. It should not manually acquire a sandbox first; delegated runs own their sandbox lifecycle.

4. Read the delegated result.

    On successful preparation, `delegate` returns the task-runtime payload, including `status`, `run_id`, `failure_reason`, and any `report_url` / `report_urls` fields. It can instead return `needs_clarification`, `rejected`, or `preparation_failed` before any batch is submitted.

5. Summarize for the user.

  Include run report URLs exactly when present. If the run generated per-case reports, mention them from `report_urls` when listing each report URL is practical.

## Practical Selection Rules

- Use `context`, then `read` or `grep`, when answering from workspace files.
- Use `parse_document` only for current-turn attachments or downloaded files, not arbitrary repo/source paths.
- Use `delegate` for durable execution, Android tests, batches, retries, summaries, and sandbox-managed work; tabular preparation consumes the shared typed source snapshot.
- Use `report` to publish local files as user-accessible URLs.
