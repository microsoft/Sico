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

The CLI has two subcommands:

- `android-tester run` — run a single test instruction on one device.
- `android-tester batch` — run a set of test cases from a JSON document, sharded across multiple devices (one async worker per device).

```sh
android-tester run --device-id <DEVICE_ID> --instructions "<TEST_INSTRUCTION>"

android-tester batch --file <CASES_JSON> --devices <DEVICE_ID> [<DEVICE_ID> ...]
```

### Common arguments (both subcommands)

| Argument | Required | Default | Description |
|---|---|---|---|
| `-o`, `--output-dir` | no | `./output/<task-id>` (run) / `./output` (batch) | Output directory. In `batch`, each task gets a `<task-id>` subdirectory under this root. |
| `--sico-endpoint` | no | `SICO_ENDPOINT` env var | Sico platform base URL |
| `--sico-app-name` | no | `sico` | Sico application name used to construct API paths |
| `--sico-agent-instance-id` | no | `SICO_AGENT_INSTANCE_ID` env var | Agent instance ID for X-Sico-Context header |
| `--llmhub-model` | no | `gpt5.4` | LLM model identifier |
| `--llmhub-model-image-size` | no | — | LLM perceived image size as `WIDTHxHEIGHT` (e.g. `1024x768`). When set, action coordinates are rescaled to match the actual screenshot size |
| `--model-auto-resize-width` | no | `768` | Target width (in pixels) for downscaling screenshots before sending them to the LLM. Set to `0` to disable. Only takes effect when `--llmhub-model-image-size` is unset. |
| `--log-level` | no | `WARNING` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) |
| `--telemetry` / `--no-telemetry` | no | enabled | Enable or disable telemetry collection |
| `--reflector` / `--no-reflector` | no | disabled | Enable or disable the reflector step after each action |
| `--max-no-progress-steps` | no | `6` | Stop after this many steps without progress |
| `--max-repetitive-actions` | no | `5` | Stop after this many identical consecutive actions |
| `--n-retries-if-failed` | no | `0` | Re-run the whole pipeline up to this many additional times on failure |

### `run` arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--device-id` | yes | — | ADB device serial or `host:port` (e.g. `10.0.0.5:5555`) |
| `--instructions` | yes | — | Natural-language test instruction to execute |
| `--task-id` | no | auto-generated UUID | Unique task identifier |
| `--task-name` | no | — | Human-readable label for the test run |
| `--device-name` | no | same as `--device-id` | Friendly device name used in logs |

### `batch` arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--file` | one of `--file`/`--test-cases` | — | Path to a JSON file with test cases. Use `-` to read JSON from stdin. |
| `--test-cases` | one of `--file`/`--test-cases` | — | Inline JSON document with the same shape as `--file`. |
| `--devices` | yes | — | One or more ADB device serials or `host:port` entries. One async worker is spawned per device; cases are pulled from a shared queue. |

#### Test-cases JSON format

```json
{
  "test-cases": [
    {
      "instruction": "Open Settings and enable Wi-Fi",
      "task-name": "Enable Wi-Fi",
      "task-id": "tc-001"
    },
    {
      "instruction": "Open Microsoft Edge and navigate to bing.com"
    }
  ]
}
```

- `instruction` is required.
- `task-name` and `task-id` are optional. Missing `task-id` is filled with an auto-generated UUID.
- The root is a dict so future top-level keys can be added without breaking existing files.

### Examples

Single run:

```sh
android-tester run \
  --device-id emulator-5554 \
  --instructions "Open Settings and enable Wi-Fi" \
  --task-name "Enable Wi-Fi"
```

Batch from a file across two devices:

```sh
android-tester batch \
  --file ./cases.json \
  --devices 127.0.0.1:5557 127.0.0.1:5559
```

Batch from inline JSON:

```sh
android-tester batch \
  --test-cases '{"test-cases":[{"instruction":"Open Settings"}]}' \
  --devices emulator-5554
```

Batch from stdin:

```sh
cat cases.json | android-tester batch --file - --devices emulator-5554
```

## Environment Variables

Configured via `config.env` in the skill root (see `config.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `SICO_ENDPOINT` | yes | — | Sico platform base URL |
| `SICO_AGENT_INSTANCE_ID` | no | — | Agent instance ID for X-Sico-Context header |
| `LLMHUB_MODEL` | no | `gpt5.4` | Model name for LLM Hub requests |
| `LLMHUB_MODEL_IMAGE_SIZE` | no | — | LLM perceived image size as `WIDTHxHEIGHT` (e.g. `1024x768`). When set, action coordinates are rescaled to match the actual screenshot size |
| `MODEL_AUTO_RESIZE_WIDTH` | no | `0` | Target width (in pixels) for downscaling screenshots before sending them to the LLM, preserving aspect ratio. Screenshots narrower than this value are sent unchanged. Required for some models (e.g. GPT-5) to effectively operate device GUIs; a typical value is `768`. Set to `0` to disable. Only takes effect when `LLMHUB_MODEL_IMAGE_SIZE` is unset. |
| `LOG_LEVEL` | no | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) |
| `TELEMETRY_ENABLED` | no | `true` | Enable telemetry collection (`true`, `false`) |
| `REFLECTOR_ENABLED` | no | `false` | Enable reflector step after each action (`true`, `false`) |
| `MAX_NO_PROGRESS_STEPS` | no | `6` | Maximum consecutive no-progress steps before stopping |
| `MAX_REPETITIVE_ACTIONS` | no | `5` | Maximum repetitive actions before stopping |

## Output

Stdout emits one JSON object per line. Every message includes an `event` field and an ISO-8601 `timestamp`.

In `run` mode, all per-step events are written to stdout. In `batch` mode, only aggregate progress events (`task_started`, `task_finished`, `task_error`) are written to stdout; per-task per-step events are written to `<output-dir>/<task-id>/events.jsonl`.

All output files are written to the output directory (logged to stdout at startup):

- **Per-task events file** (batch only): `<output-dir>/<task-id>/events.jsonl`
- **Per-task error trace** (batch only, on exception): `<output-dir>/<task-id>/error.txt`
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

### Batch progress events (stdout, `batch` mode only)

**`task_started`** — emitted when a worker picks up a case:

```json
{"event": "task_started", "task_id": "...", "task_name": "...", "device_id": "127.0.0.1:5559", "instruction": "...", "log_file": "output/<task-id>/events.jsonl", "completed": 3, "succeeded": 2, "failed": 1, "total": 10, "remaining": 7, "progress": 0.3}
```

**`task_finished`** — emitted when a case finishes (success or failure):

```json
{"event": "task_finished", "task_id": "...", "task_name": "...", "device_id": "127.0.0.1:5559", "status": "completed", "log_file": "output/<task-id>/events.jsonl", "completed": 4, "succeeded": 3, "failed": 1, "total": 10, "remaining": 6, "progress": 0.4}
```

**`task_error`** — emitted when a case raises an unhandled exception. The full traceback is also written to `<output-dir>/<task-id>/error.txt`:

```json
{"event": "task_error", "task_id": "...", "task_name": "...", "device_id": "127.0.0.1:5559", "log_file": "output/<task-id>/events.jsonl", "error_file": "output/<task-id>/error.txt", "error": "...", "error_type": "ADBCommandError"}
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All test cases completed successfully |
| `1` | At least one test case failed |
