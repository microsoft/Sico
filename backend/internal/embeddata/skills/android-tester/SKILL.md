---
name: android-test
description: Execute an Android UI test case on a sandbox device, review results, and produce a structured execution report.
argument-hint: Describe the test instruction to execute on the Android device
---

# Android Tester Skill

Execute an Android UI test case, review the results, and generate a structured execution report.

## When to use

- Run end-to-end Android UI tests from natural language instructions
- Verify app workflows on an Android emulator sandbox
- Produce structured test execution reports

## Workflow

1. **Environment preparation**: install dependencies in the execution environment
2. **Run test case(s)**: execute `android-tester` against the sandbox device for each test case
3. **Review & execution report**: review all results and produce a single regression testing delivery report
4. **Summarize**: give the user a short summary of the testing outcome and recommendation for release

---

## 1. Environment Preparation

### Prerequisites

- An allocated Android sandbox (emulator device reachable via ADB)
- `python` >= 3.11
- `uv`

### Dependencies

From the skill root directory (`$SKILL_ROOT`), run:

```sh
uv sync
sh scripts/install-adb.sh
```

---

## 2. Run Test Case

Before running the test case, reset the sandbox using appropriate sandbox tools.

Then run `android-tester` with the appropriate arguments. Make sure to provide a short descriptive name for the test case in `--task-name` to easily identify it in the final report.

When running multiple test cases, prefer the `batch` subcommand if more than one device is available — it shards cases across devices in parallel. Otherwise execute them sequentially without pausing for confirmation between cases. The execution is expected to be uninterrupted. If any concerns or issues arise during individual runs, include them in the final report rather than stopping to ask.

`android-tester` has two subcommands:

- `android-tester run` — execute a single instruction on one device.
- `android-tester batch` — execute many test cases from a JSON document, sharded across multiple devices (one async worker per device).

### `run` arguments

- `--instructions`: the natural-language test instructions to execute
- `--device-id`: address of the allocated Android device (e.g. `10.0.0.5:5555`)
- `--task-name`: short description of the test case

#### Example

```sh
android-tester run \
 --device-id 10.0.0.5:5555 \
 --instructions "Open Settings and enable Wi-Fi" \
 --task-name "Enable Wi-Fi"
```

### `batch` arguments

- `--file PATH` — JSON file with shape `{"test-cases": [{"instruction": ..., "task-name": ..., "task-id": ...}, ...]}`. `instruction` is required; the other fields are optional. Use `-` to read JSON from stdin.
- `--test-cases JSON` — same shape as `--file` but inline. Mutually exclusive with `--file`.
- `--devices ID [ID ...]` — one or more ADB device serials or `host:port` entries. One worker is spawned per device.

#### Example

```sh
android-tester batch \
 --file ./cases.json \
 --devices 10.0.0.5:5555 10.0.0.6:5555
```

### Execution timeout

`android-tester` enforces its own end-to-end execution timeout of **3600 seconds (1 hour)** per test case. When invoking it through `run_command` (or any other shell-execution tool), **do not** pass a `timeout` lower than this value — use `timeout=0` (no external timeout) or a value of at least `3600`. For `batch`, use `timeout=0` since the wall-clock time scales with the number of cases.

### Output

`android-tester` outputs one JSON line per event to stdout. Each line contains an `event` field, a `timestamp`, and event-specific data.

In `run` mode, all per-step events go to stdout. In `batch` mode, only aggregate progress events (`task_started`, `task_finished`, `task_error`) go to stdout — each carries `task_id`, `device_id`, `log_file`, and `completed`/`succeeded`/`failed`/`total`/`remaining`/`progress` counters. Per-task per-step events are written to `<output-dir>/<task-id>/events.jsonl`. The output directory path is logged to stdout at startup.

### Exit codes

- `0`: all test cases executed successfully
- `1`: at least one test case failed

`README.md` contains full documentation on `android-tester` arguments, environment variables, and output event types. Its lecture is optional.

---

## 3. Review & Execution Report

After all test cases have been executed, review the output of each test case and produce a single **Regression Testing Delivery Report** named `Regression Testing Report.md` in your workspace directory. Base the report on the stdout JSON logs and report files from each test case run. If no report file is generated for a test case, leave the "execution log" field for that test case blank. All links must be valid http(s) links.

If a batch of test cases was executed, summarize all of them in this single report. Do not output the `*.html`, `*.jsonl` and `*.stderr` files directly, unless explicitly requested by the user.

The report must **strictly** follow this template:

# Regression Testing Delivery Report

## 1. Test Details

| # | Field            | Content                                            |
|---|------------------|----------------------------------------------------|
| 1 | Report Date      | [YYYY.MM.DD]                                       |
| 2 | Test Pass Status | Completed / Blocked                                |
| 3 | Testing Minutes  | [X] mins                                           |
| 4 | Test Environment | - Sandbox/device Name 1<br>- Sandbox/device Name 2 |

## 2. Execution Summary

| # | Metric                 | Value                         |
|---|------------------------|-------------------------------|
| 1 | Total Cases            | [Total]                       |
| 2 | Executed               | [Executed]                    |
| 3 | Passed                 | [Passed]                      |
| 4 | Failed                 | [Failed]                      |
| 5 | Blocked                | [Blocked]                     |
| 6 | Execution Rate         | [XX%]                         |
| 7 | Pass Rate              | [XX%]                         |
| 8 | Release Recommendation | [Go / Conditional Go / No-Go] |

## 3. Test Scope

| # | Module / Feature     | Total Cases | Executed           | Passed            | Failed   | Blocked   |
|---|----------------------|-------------|--------------------|-------------------|----------|-----------|
| 1 | [Module / feature 1] | [Total]     | [Executed] ([XX%]) | [Passed] ([XX%])  | [Failed] | [Blocked] |
| 2 | ...                  |             |                    |                   |          |           |

## 4. Execution Analysis

### 4.1 Bug Analysis

- **Total Unique Bugs**: [X]
- **Total Failed Cases**: [X]

| # | Bug Title     | Description                                                                | Impacted Cases                                        |
|---|---------------|----------------------------------------------------------------------------|-------------------------------------------------------|
| 1 | [Short Title] | Clear, concise explanation of the bug (what is wrong vs expected behavior) | [N] cases:<br>- [Case Name 1]<br>- [Case Name 2]       |
| 2 | ...           |                                                                            |                                                       |

### 4.2 Block Analysis

- **Total Unique Blockers**: [X]
- **Total Blocked Cases**: [X]

| # | Blocker Type  | Description                                                   | Impacted Cases                                        |
|---|---------------|---------------------------------------------------------------|-------------------------------------------------------|
| 1 | [Short Title] | Clear, concise explanation of the blocker (the environment)   | [N] cases:<br>- [Case Name 1]<br>- [Case Name 2]       |
| 2 | ...           |                                                               |                                                       |

## 5. Release Recommendation

### Recommendation
[Go / Conditional Go / No-Go]

### Rationale
- Reason 1
- Reason 2

## 6. Detailed Case Result Reference

| # | Case ID  | Case Title  | Module   | Case Step | Execution Time | Result                | Execution Log                                                   |
|---|----------|-------------|----------|-----------|----------------|-----------------------|-----------------------------------------------------------------|
| 1 | [TC-001] | [Case Name] | [Module] | [X]       | X mins         | Pass / Fail / Blocked | [TC-001 Execution Log](https://example.org/link/to/report.html) |
| 2 | ...      |             |          |           |                |                       |                                                                 |

## 4. Summarize

After producing the report, give the user a short summary of the testing outcome(s) and your recommendation for release. The summary should be concise and highlight the key points from the report, such as overall pass/fail rates, major blockers, and your final recommendation on whether to proceed with the release. If you include any files in the summary, make sure to provide http(s) links with readable short names, e.g., [My File](https://example.com/link/to/my-file.txt). 

**CRITICAL**: All links must be valid. Only take links from information sources available to you (e.g., plan, deliverables, reports, logs, etc.). Avoid links to workspace-local files because the user cannot access them. If the user requests workspace-local files, use the `report` tool to upload them first and provide the corresponding http(s) link.