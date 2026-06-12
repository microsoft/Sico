# android-tester

`android-tester` is a CLI tool for Q/A testing of Android apps on internal development devices. 

To reliably run test cases, it uses a vision-based dual-agent loop:

- **Operator** — selects the next UI action from the current screen context.
- **Reflector** — evaluates before/after screenshots and updates progress.

Test instructions are given in natural language. Progress and results are streamed to stdout as JSON lines.

## Prerequisites

- `python` >= 3.11
- `uv`
- `make` (optional)
- A reachable Android device or emulator (USB or network ADB)

## Installation

From the skill directory:

```sh
make install
```

This installs Python dependencies (via `uv`) and ADB.

The CLI loads configuration from an optional `config.env` file in the skill root.

Copy `config.env.example` to get started:

```sh
cp config.env.example config.env
```

Priority (highest wins): CLI arg > env var > `config.env` > built-in default.

## Usage

```sh
android-tester --device-id <DEVICE_ID> --instructions "<TEST_INSTRUCTION>"
```

### Arguments

Argument values such as `--instructions`, `--task-name`, `--precondition`, and `--keep-app-state` are literal CLI strings, not paths to workspace files.

| Argument | Required | Default | Description |
|---|---|---|---|
| `-o`, `--output-dir` | no | `./output/<task-id>` | Directory for output files (screenshots, logs, report). |
| `--device-id` | yes | — | ADB device serial or `host:port` (e.g. `10.0.0.5:5555`). |
| `--instructions` | yes | — | Natural-language test instruction to execute. |
| `--task-id` | no | auto-generated UUID | Unique task identifier. |
| `--task-name` | no | — | Human-readable label for the test run. |
| `--device-name` | no | same as `--device-id` | Friendly device name used in logs. |
| `--precondition` | no | — | One atomic precondition in `label: description` form; the `label` is short, lowercase, hyphenated. **Repeatable** — supply once per precondition. On first use of a label, the precondition is established from its description and a reusable script is recorded under `<output-dir>/preconditions/<label>/` (`action_log.json` plus a `description.txt`). On repeat, the cached script is replayed without LLM calls. |
| `--sico-app-name` | no | `sico` | Sico application name used to construct API paths. |
| `--llmhub-model` | no | `gpt5.4` | LLM model identifier. |
| `--coordinate-space` | no | — | `(x, y)` space the LLM emits coordinates in, as `WIDTHxHEIGHT` (e.g. `1000x1000` for UI-TARS / UI-Venus style models). When unset, the LLM is told the perceived image size equals the size of the screenshot it received. |
| `--max-screenshot-size` | no | `784x1568` | Max size of the screenshot sent to the LLM, as `WIDTHxHEIGHT`. Screenshots are downscaled to fit within these bounds preserving aspect ratio; smaller screenshots are sent unchanged. Set to empty to disable resizing. |
| `--log-level` | no | `WARNING` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`). |
| `--telemetry` / `--no-telemetry` | no | enabled | Enable or disable telemetry collection. |
| `--log-llm-inputs` / `--no-log-llm-inputs` | no | disabled | Log LLM prompts in operator/reflector records. |
| `--reflector` / `--no-reflector` | no | disabled | Enable or disable the reflector step after each action. |
| `--max-no-progress-steps` | no | `6` | Stop after this many steps without progress. |
| `--max-repetitive-actions` | no | `5` | Stop after this many identical consecutive actions. |
| `--n-retries-if-failed` | no | `0` | Re-run the whole pipeline up to this many additional times on failure. |
| `--history-length` | no | `0` | Number of previous operator turns (prompt + screenshot + response) to include as multi-turn history. |
| `--keep-app-state` | no | empty | Comma-separated Android package names whose state must be kept across device resets between test cases (e.g. `com.android.chrome,com.microsoft.emmx`). |
| `--resources-path` | no | — | Directory holding files the agent can stage on the device. When set, the file tools (`ResourceList`, `FilePut`, `FileList`, `FileDelete`) become available (see [File tools](#file-tools)). |

### File tools

The file tools are available **only when `--resources-path` is set** — without a resources directory there is nothing to stage, so none of them are offered to the operator. When establishing preconditions, the operator can then read and write files on the device's `/sdcard` storage:

| Tool | Description |
|---|---|
| `ResourceList()` | List the files available in `--resources-path` that can be staged with `FilePut`. |
| `FilePut(source, dest)` | Copy a resource (`source`, relative to `--resources-path`) into a folder under `/sdcard` (`dest`, e.g. `Pictures`, `Download`, `DCIM`). The file keeps its name and is registered with the gallery/Files apps via a media scan. |
| `FileList(path)` | List the contents of `/sdcard/<path>` (defaults to the `/sdcard` root). |
| `FileDelete(path)` | Delete a file under `/sdcard` (e.g. `Pictures/cat.jpg`) and trigger a media rescan. |

Resource and device paths are validated to stay within `--resources-path` and `/sdcard` respectively; `..` traversal is rejected. Because precondition scripts are cached and replayed, a `FilePut` recorded for a label re-reads its `source` from the resources directory on replay — pass the same `--resources-path` (containing that file) when reusing such a label.

At the **start of every run**, external storage (`/storage/emulated/0`, i.e. `/sdcard`) is snapshotted to a gzipped tar under `/data/local/tmp/.android-tester/backup/<task-id>/`. When the run ends, that snapshot is restored as a **sync**: every live file whose path is absent from the archive (data created during the run, e.g. camera shots, temp files, prepared files) is deleted, then the archive is extracted to bring back modified or deleted files, followed by a single MediaStore volume rescan.

### Examples

Single run:

```sh
android-tester \
  --device-id emulator-5554 \
  --instructions "Open Settings and enable Wi-Fi" \
  --task-name "Enable Wi-Fi"
```

Run with labelled preconditions (recorded on first use, replayed thereafter). `--precondition` is repeatable, one per atomic precondition:

```sh
android-tester \
  --device-id emulator-5554 \
  --precondition "signed-in-msa: User is signed in to Edge with an MSA account" \
  --precondition "strict-tracking-off: Tracking prevention is set to Basic" \
  --instructions "Enable strict tracking prevention and verify" \
  --task-name "Strict tracking prevention"
```

## Environment Variables

The following environment variables can be configured via `config.env` in the skill root. Every CLI flag has a matching env var; CLI args override env vars, which override `config.env`, which overrides built-in defaults.

**Platform connection**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SICO_ENDPOINT` | no | `http://host.docker.internal:8080` | Sico platform base URL. Defaults to the host's docker-internal address; override when pointing at a remote backend. |
| `SICO_AGENT_INSTANCE_ID` | no | — | Agent instance ID for the `X-Sico-Context` header |

**Per-task**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `DEVICE_ID` | yes (unless `--device-id` given) | — | ADB device serial or `host:port` |
| `INSTRUCTIONS` | yes (unless `--instructions` given) | — | Natural-language test instruction |
| `TASK_ID` | no | auto-generated UUID | Unique task identifier |
| `TASK_NAME` | no | — | Human-readable label for the run |
| `DEVICE_NAME` | no | same as `DEVICE_ID` | Friendly device name used in logs |

**LLM**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `LLMHUB_MODEL` | no | `gpt5.4` | Model name for LLM Hub requests |
| `COORDINATE_SPACE` | no | — | (x, y) space the LLM emits coordinates in, as `WIDTHxHEIGHT` (e.g. `1000x1000` for UI-TARS / UI-Venus style models). When unset, the LLM is told the perceived image size equals the size of the screenshot it received. Action coordinates are always rescaled to device pixels before being sent to ADB. |
| `MAX_SCREENSHOT_SIZE` | no | `784x1568` | Max size of the screenshot sent to the LLM, as `WIDTHxHEIGHT`. Screenshots are downscaled to fit within these bounds preserving aspect ratio; smaller screenshots are sent unchanged. Required for some models (e.g. GPT-5) to effectively operate device GUIs. Leave empty to disable resizing. |

**Output / platform routing**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `SICO_RESULT_DIR` | no | `./output/<task-id>` | Directory for output files (screenshots, logs, report) |
| `SICO_APP_NAME` | no | `sico` | Sico application name used to construct API paths (`/api/<sico-app-name>/...`) |
| `RESOURCES_PATH` | no | — | Directory holding files the agent can stage on the device via the `FilePut` / `ResourceList` tools |

**Logging / telemetry**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | no | `WARNING` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) |
| `TELEMETRY_ENABLED` | no | `true` | Enable telemetry collection (`true`, `false`) |
| `LOG_LLM_INPUTS` | no | `false` | Log LLM prompts in operator/reflector records (`true`, `false`) |

**Runner tuning**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `REFLECTOR_ENABLED` | no | `false` | Enable reflector step after each action (`true`, `false`) |
| `MAX_NO_PROGRESS_STEPS` | no | `6` | Maximum consecutive no-progress steps before stopping |
| `MAX_REPETITIVE_ACTIONS` | no | `5` | Maximum repetitive actions before stopping |
| `N_RETRIES_IF_FAILED` | no | `0` | Re-run the whole pipeline up to this many additional times on failure |
| `HISTORY_LENGTH` | no | `0` | Number of previous operator turns (prompt + screenshot + response) to include as multi-turn history |
| `KEEP_APP_STATE` | no | empty | Comma-separated Android package names whose state must be kept across device resets between test cases (e.g. `com.android.chrome,com.microsoft.emmx`) |

## Output

Stdout emits one JSON object per line. Every message includes an `event` field and an ISO-8601 `timestamp`. All per-step events are written to stdout.

All output files are written to the output directory (logged to stdout at startup):

- **Screenshots**: `step-NNN-1-before.png`, `step-NNN-2-after.png`
- **Report**: `report.html` — self-contained HTML report with screenshots, execution summary, and per-step logs

### Event types

**`screenshot`** — captured before/after each action:

```json
{"event": "screenshot", "timestamp": "2026-04-14T09:15:02.123456+00:00", "task_id": "...", "step": 1, "image_path": "logs/step_001_before.png", "description": "before-action"}
```

**`operator_log`** — operator agent output (thought, action, description):

```json
{"event": "operator_log", "timestamp": "2026-04-14T09:15:03.456789+00:00", "task_id": "...", "step": 1, "message": "PressBack()"}
```

**`reflector_log`** — reflector agent output (outcome, progress, next goal):

```json
{"event": "reflector_log", "timestamp": "2026-04-14T09:15:04.789012+00:00", "task_id": "...", "step": 1, "message": "Wi-Fi toggle is now enabled. Progress: 80%"}
```

**`task_result`** — final execution result:

```json
{"event": "task_result", "timestamp": "2026-04-14T09:15:30.345678+00:00", "task_id": "...", "duration": 32.4, "status": "completed", "reason": "Task completed successfully"}
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Test case completed successfully |
| `1` | Test case failed |
