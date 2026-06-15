---
name: android-tester
description: Execute Android UI workflows on a sandbox device, review results, and produce a structured execution report.
private_inputs:
  msa_credentials: microsoft_account
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

### Preconditions

**You MUST use `--precondition` whenever a test case has a precondition.** Never embed precondition text in `--instructions`.

`--precondition` is repeatable, once per atomic precondition, each in `label: description` form (`label` = text before the first `: `; short, lowercase, hyphenated, no colon). Decompose a test case's `preconditions` block into atomic items:

1. **List all known preconditions**: preconditions are stored in `<output-dir>/preconditions/` as sub-dirs named after their labels. Reuse existing labels whenever possible for better script caching and faster execution.
2. **List all atomic preconditions and data points**: decompose the test case's preconditions into atomic items and data points. Each atomic precondition should be a single state to establish, e.g., "home screen", "signed in to Copilot with test account", "files present in Google Drive". Avoid conjunctions like "and" that combine multiple states into one item.
3. **Cluster all atomic preconditions**: cluster identical atomic preconditions together under one label. Example: "the user is signed out" is identical to "the user is not logged in".
4. **Write descriptions**: for each unique atomic precondition, write a clear description of 1. what to check for to verify the state, and 2. how to *likely* establish it if not already met. The description should be detailed enough for a human tester to understand and follow, but concise enough to fit in a single CLI argument (ideally <300 characters).
5. **Pass preconditions to the CLI**: pass each atomic precondition as a separate `--precondition "label: description"` argument when invoking `android-tester`.
6. **Data points**: if the test case has data points (credentials, file names, URLs, etc.), fold them into the descriptions of the relevant preconditions or instructions.

Preconditions are established in the order given. On a label's first use the tool establishes the state and records a reusable script under `<output-dir>/preconditions/<label>/` (`action_log.json` plus a `description.txt`); on repeat it replays the script without LLM calls. Cases without a precondition run with just a device reset.

### Execution

The device is reset automatically before each test case. When running multiple test cases, execute them sequentially without pausing for confirmation between cases. The execution is expected to be uninterrupted. If any concerns or issues arise during individual runs, include them in the final report rather than stopping to ask.

### Arguments

These argument values are literal CLI strings. Do not write `instructions`, `task_name`, `precondition`, or `keep_app_state` to workspace files and do not pass them as `{workspace_dir}/...` paths; pass their parameter values directly.

- `--instructions`: the test steps to execute (precondition text must NOT be included here)
- `--device-id`: address of the allocated Android device (e.g. `10.0.0.5:5555`)
- `--task-name`: short label for the test case (max 5–10 words, e.g. `"Sign in MSA"` not the full test case title).
- `--precondition "label: description"`: one atomic precondition in `label: description` form. Repeatable — supply it once per atomic precondition (see Preconditions above).
- `--resources-path`: directory holding files the test case needs staged on the device (photos, documents, etc.). Pass it whenever a precondition requires files to be present in `/sdcard` folders such as `Pictures`, `Documents`, etc.

#### Example

```sh
android-tester \
 --device-id 10.0.0.5:5555 \
 --precondition "home-screen: the Android device shows the home screen" \
 --precondition "signed-out: User is signed out of Copilot" \
 --instructions "Launch Copilot and sign in with MSA account" \
 --task-name "Sign in MSA"
```

### Execution timeout

`android-tester` enforces its own end-to-end execution timeout of **3600 seconds (1 hour)** per test case. When invoking it through `run_command` (or any other shell-execution tool), **do not** pass a `timeout` lower than this value — use `timeout=0` (no external timeout) or a value of at least `3600`. When running multiple cases sequentially, use `timeout=0` since the wall-clock time scales with the number of cases.

### Keeping app state across cases

`android-tester` wipes the app data of open apps before and after each test case to ensure a predictable initial state. If the user explicitly requests to not wipe certain apps, pass `--keep-app-state` with a comma-separated list of fully qualified Android package names (e.g. `com.android.chromium,com.android.settings`).

Do **not** guess the package name. Resolve it on the actual device first, e.g., using

```sh
# List all packages whose name contains 'chrome' (case-insensitive)
adb -s <device-id> shell pm list packages | grep -i chrome

# List only user-installed (third-party) packages
adb -s <device-id> shell pm list packages -3
```

Pick the exact `package:<name>` line(s) and pass the `<name>` portion to `--keep-app-state`. If the user requests to preserve an app but you cannot find its package name, include that in the final report as a blocker and proceed without preservation.

### Output

`android-tester` outputs one JSON line per event to stdout. Each line contains an `event` field, a `timestamp`, and event-specific data.

All per-step events go to stdout. The output directory path is logged to stdout at startup.

### Exit codes

- `0`: test case executed successfully
- `1`: test case failed
- `2`: test case blocked

`README.md` contains full documentation on `android-tester` arguments, environment variables, and output event types. Its lecture is optional.

---

## 3. Review & Execution Report

After all test cases have been executed, review the output of each test case and produce a single **Regression Testing Delivery Report** named `Regression Testing Report.md` in your workspace directory. Base the report on the stdout JSON logs and report files from each test case run. If no report file is generated for a test case, leave the "execution log" field for that test case blank. All links must be valid http(s) links.

If multiple test cases were executed, summarize all of them in this single report. Do not output the `*.html`, `*.jsonl` and `*.stderr` files directly, unless explicitly requested by the user.

The report must **strictly** follow this template:

```markdown
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
```

## 4. Summarize

After producing the report, give the user a short summary of the testing outcome(s) and your recommendation for release. The summary should be concise and highlight the key points from the report, such as overall pass/fail rates, major blockers, and your final recommendation on whether to proceed with the release. If you include any files in the summary, make sure to provide http(s) links with readable short names, e.g., [My File](https://example.com/link/to/my-file.txt). 

**CRITICAL**: All links must be valid. Only take links from information sources available to you (e.g., plan, deliverables, reports, logs, etc.). Avoid links to workspace-local files because the user cannot access them. If the user requests workspace-local files, use the `report` tool to upload them first and provide the corresponding http(s) link.