# Chat Agent Tools

Sico's chat agent receives a different tool set depending on the **route** chosen for the turn. A hard guard plus an LLM intent checker classify each turn into one of three routes (`fast`, `inspect`, `task`); the route then determines which tools the agent is given.

Route classification and the per-route tool lists live in `core/app/biz/chat/router.py` (`ChatRouteMode` and `tools_for_route`). The `task` route is additionally augmented at runtime with a single `delegate` tool that selects a registered adapter via its `kind` argument, wired by the chat service (`core/app/biz/chat/service.py`) from `build_adapter_tools` (`core/app/tools/delegate.py`). Individual tool implementations live under `core/app/tools/`.

## Routes

| Route | Purpose | Tools exposed |
|---|---|---|
| `fast` | Direct answer mode. No tools. | none |
| `inspect` | Read-only inspection / planning. | `context`, `read`, `grep`, `plan_read`, `plan_write`, `plan_tool_call_message_update`, `search_memory`, `webfetch`, `parse_document` |
| `task` | Delegated task execution plus workspace edit/report. | `context`, `read`, `grep`, `write_file`, `edit`, `remove`, `report`, `plan_read`, `plan_write`, `plan_tool_call_message_update`, `webfetch`, `curl`, `search_memory`, `parse_document`, `download`, and a single `delegate` tool whose `kind` selects a registered adapter (currently `general`, `workbook`) |

The "real work" of durable execution is intentionally funneled through the `delegate` tool on the `task` route. `run_command`, `invoke_skill`, `extract_workbook_cases`, `get_task_detail`, and the `sandbox_*` lifecycle tools are **not** wired into any current chat route — each `delegate` call owns task scheduling, sandbox lifecycle, retries, and result summaries end to end.

## Summary

| Tool | Route(s) | What it does | Typical use |
|---|---|---|---|
| `context` | inspect, task | Lists visible workspace files, skill summaries, and knowledge summaries. | Discover what files, skills, attachments, and knowledge are available. |
| `read` | inspect, task | Reads a workspace-relative text file with line limits. | Inspect exact files after `context` or a known path. |
| `grep` | inspect, task | Searches workspace files with a regex. | Locate content without loading large files. |
| `write_file` | task | Writes a file into the workspace. | Create scripts, data files, notes, or generated artifacts. |
| `edit` | task | Replaces text in an existing workspace file. | Patch a generated script or document. |
| `remove` | task | Deletes a workspace file or directory. | Clean obsolete workspace artifacts. |
| `plan_read` | inspect, task | Reads the current turn plan. | Check task progress before modifying it. |
| `plan_write` | inspect, task | Writes the full current turn plan. | Create/update visible execution steps. |
| `plan_tool_call_message_update` | inspect, task | Updates an existing tool-call message. | Refine displayed tool progress. |
| `parse_document` | inspect, task | Parses a current-turn attachment under `attachments/**` or downloaded file under `download/**`. | Extract text/tables from PDF, DOCX, PPTX, XLSX, and similar documents. |
| `download` | task | Downloads a public direct-file URL into the workspace and extracts supported document content. | Bring a public PDF/DOCX/XLSX into the workspace. |
| `webfetch` | inspect, task | Fetches public web page content as Markdown-like text. | Read documentation or information pages. |
| `curl` | task | Runs a `curl` command with standard curl flags. | Call HTTP APIs, inspect headers/status, or use authenticated requests when credentials are handled externally. |
| `delegate` | task | A single tool whose `kind` argument selects a registered adapter (e.g. `general`, `workbook`). It takes an `options_json` string, expands it into a task batch, and submits it to the task runtime for scheduling, retries, sandbox lifecycle, sidechain logs, and summaries. The call returns the task-runtime payload directly. | Run durable skill/tool jobs, especially Android test cases or workbook batches. |
| `report` | task | Uploads turn report files or workspace-local files and returns shareable URLs. | Publish final reports or user-requested local artifacts. |
| `search_memory` | inspect, task | Retrieves related memories for the user/agent. | Reuse learned preferences or prior operational knowledge. |

## Workspace Visibility

The agent's active workspace is intended for current inputs, skill cortex files, knowledge snapshots, attachments, and files intentionally created during the current turn.

Historical turn archives and direct skill results are intentionally not LLM-visible workspace context:

- `history/` is not copied into the active workspace.
- `.results/` is removed from the active workspace during workspace init.
- `context` hides stale `history/` and `.results/` directories if they already exist.
- Direct `invoke_skill` output is stored under turn-scoped storage such as `turn/{turn_id}/results/skills/{skill_id}/{run_id}/`.

This keeps old reports and historical conversations from distracting the model. Historical case sources and rerun payloads remain archived under turn storage and are surfaced through bounded source-resolution prompts when relevant.

## Delegation

The `delegate` tool is the chat agent's way to run durable, scheduled, retried, and summarized work, including batches. Pick the adapter with the `kind` argument that matches the work: `kind="general"` for free-form skill/tool instructions, `kind="workbook"` for structured workbook batches. Delegation owns the full lifecycle (sandbox acquisition, release, result summaries, retries), which is why it is preferred for Android test execution.

The `delegate` tool takes a `kind` argument plus a single `options_json` argument: a JSON **string** that decodes to the selected adapter's options schema. For `kind="general"` the decoded object looks like:

```json
{
  "instructions": [
    "Test steps:\n1. Open Microsoft Edge on the Android device.\n2. Handle first-run or permission prompts with the safest option that reaches the browser home screen.\n3. Focus the address bar.\n4. Enter www.baidu.com and navigate.\n5. Wait until the Baidu page is displayed.\n6. Quit Microsoft Edge."
  ],
  "skill_capabilities": [
    {
      "skill_name": "android-tester",
      "action_name": "run_android_test_case",
      "requires_sandbox": "emulator"
    }
  ]
}
```

Each `instructions` entry becomes one task; the adapter's planner maps it onto the supplied `skill_capabilities` / `direct_tools`. `kind="workbook"` instead decodes `options_json` into its workbook options (source selection, scope, and per-case expansion).

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

3. Prefer `delegate` with `kind="general"` (or the `kind` that matches the work) for the actual run.

   The model should describe the skill capability with `skill_name`, `action_name`, `requires_sandbox`, and complete natural-language `instructions`. It should not manually acquire a sandbox first; delegated runs own their sandbox lifecycle.

4. Read the delegated result.

  The `delegate` tool returns the task-runtime payload directly, including `status`, `run_id`, `failure_reason`, and any `report_url` / `report_urls` fields. Summarize it from the returned digest.

5. Summarize for the user.

  Include run report URLs exactly when present. If the run generated per-case reports, mention them from `report_urls` when listing each report URL is practical.

## Practical Selection Rules

- Use `context`, then `read` or `grep`, when answering from workspace files.
- Use `parse_document` only for current-turn attachments or downloaded files, not arbitrary repo/source paths.
- Use the `delegate` tool for durable execution, Android tests, batches, retries, summaries, and sandbox-managed work; the adapter performs any workbook extraction itself.
- Use `report` to publish local files as user-accessible URLs.
