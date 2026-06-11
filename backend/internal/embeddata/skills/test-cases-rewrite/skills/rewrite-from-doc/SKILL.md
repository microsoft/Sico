---
name: rewrite-from-doc
description: "Rewrite human-authored test cases into GUI Agent executable format using Feature Doc and Action Space. Use when: rewriting test cases for GUI agent execution, converting manual test steps into fine-grained executable actions, batch-rewriting test case CSV files, producing rewritten JSONL/CSV output."
argument-hint: "Provide the input CSV path and Feature Doc path (.jsonl or .md). Other settings are auto-configured via config.env."
---

# Skill: Rewrite Test Cases from Feature Doc

## Purpose

Rewrite human-authored, coarse-grained test cases into **GUI Agent executable** fine-grained test steps. Each rewritten test case is self-contained, starts from a clean environment, and every step maps to a concrete GUI action (Click, Type, Scroll, etc.) with an observable `expected_result`.

This skill orchestrates the rewrite pipeline: parse CSV input → build LLM prompts with Feature Doc context → call the Sico LLM Hub → format and save output.

**Prerequisite**: The input CSV and Feature Doc (`.jsonl` or `.md`) must be ready. `Action_Space.md` and pipeline settings are auto-configured.

**Output defaults**: When presenting results to the user, deliver only the **rewritten CSV** file link and a short summary. Do not paste raw JSONL, model output JSON, or intermediate files into the conversation. If a Feature Doc was generated during this session, include its MD link as well.

---

## Pre-flight

Before invoking the pipeline, validate three pre-flight categories: **inputs** (what files you have), **config** (how the pipeline is wired), and **split triage** (how each input case should be decomposed). Batch & model tuning hints live here too since they all influence the run that hasn't happened yet.

### Inputs

| Input | Format | Required | Description |
|-------|--------|----------|-------------|
| Test case CSV | `.csv` | Yes | Columns: `Title`, `Description`, `Platform`, `Project Name`, `Steps` |
| Feature Doc | `.jsonl` or `.md` | Yes | Product/feature context document (produced by the orchestrator's knowledge discovery or manually) |
| Action Space | `.md` | No | GUI Agent supported action definitions (auto-detected from skill directory) |
| Start screenshot | `.jpg` / `.png` | No | Starting screen screenshot for multimodal prompting (auto-detected if exists) |

### Input CSV Normalization

The pipeline requires exactly these 5 columns: **`Title`**, **`Description`**, **`Platform`**, **`Project Name`**, **`Steps`**. Real-world CSVs rarely arrive in this format. Before running the pipeline, normalize the input:

| Situation | Action |
|-----------|--------|
| CSV has `ID` column but no `Description` / `Steps` | Copy `Title` into both `Description` and `Steps`; keep `ID` column as-is (it passes through to output) |
| CSV has `Steps` but as a single summary sentence | Keep as-is; the LLM will expand it during rewrite |
| CSV has `Test Steps` / `Procedure` instead of `Steps` | Rename the column to `Steps` |
| CSV has `App` / `Application` instead of `Project Name` | Rename to `Project Name` |
| CSV has extra columns (e.g., `Priority`, `Status`) | Keep them; the pipeline ignores unknown columns and passes them through to output |
| CSV uses TSV (tab-separated) | Set `input.format: "csv"` and use tab delimiter, OR convert to CSV first |
| CSV has BOM (byte order mark) | Set `input.encoding: "utf-8"` — the parser handles BOM automatically |
| `Platform` is empty for some rows | Fill with the batch-level platform (e.g., "Copilot Android") before running |

The batch script `scripts/batch_rewrite_multi_feature.py` handles the common case automatically: when `Description` or `Steps` columns are missing, it uses `Title` as a fallback for both.

### Configuration

All pipeline settings are configured via **environment variables** (loaded from `config.env`) and **CLI arguments**. No config file is needed for normal operation.

Settings are read in this priority order: **CLI argument > environment variable > built-in default**.

The `config.env` file (auto-discovered in the skill root directory) controls shared settings:

```env
# config.env
LLMHUB_MODEL=gpt5.4
SICO_APP_NAME=sico
# SICO_ENDPOINT=http://localhost:8080
# SICO_RESULT_DIR=
# MAX_WORKERS=3
# BATCH_SIZE=20
# TIMEOUT_SECONDS=300
# MAX_RETRY_ROUNDS=3
```

<details>
<summary>Legacy: config.yaml mode</summary>

The `--config` flag is still supported for backward compatibility. If provided, settings are loaded from a YAML file. YAML configs support `base_config` inheritance for multi-feature batch scenarios. See the source code for the full YAML schema.

</details>

### Input Split Triage

Test cases that bundle multiple independent test points lose per-point observability after rewrite: a case "verifying all 9 buttons" reports only 1 pass/fail outcome instead of 9, and any sub-point failure leaves the rest as `not executed`. GUI Agent reliability also degrades sharply once a single rewritten case exceeds ~20 fine-grained steps.

Apply this triage **before** Step 4 (Run the Pipeline) on each input case, using only signals observable from the **original** `Title` + `Steps` (you do not yet have the post-rewrite step count). Each case ends up in one of three buckets:

- `must-split` — decompose into N independent inputs upstream; rewrite each separately
- `keep-merged` — multi-point structure is intrinsic to the test; do not split
- `default` — pass through; rely on the [Post-rewrite Step-Count Check](#post-rewrite-step-count-check) in Quality Methodology

#### Split Rules (any match → `must-split`)

| Rule | Pattern in Title / Steps | Example |
|------|--------------------------|---------|
| **R1 Enumeration** | "all X" / "each X" / parenthesized list of 2+ items | `"(MSA, Pro)"`, `"all 9 buttons"` |
| **R2 Cross-team enumeration** | Enumerated items span different feature/product areas | `"(podcast, 3D, deep research, Pages, Discover)"` |
| **R3 "Verify all N"** | `verify all N ... work` with N ≥ 3 | `"verify all these 4 features work"` |
| **R4 Independent dimensions** | "X and Y" connecting independent accounts / platforms / modes | `"MSA and Pro account"`, `"iOS and Android"` |

#### Override Rule (takes precedence → `keep-merged`)

| Override | Condition | Reason |
|----------|-----------|--------|
| **K1 Causal dependency** | Sub-point B's setup or verification **depends on the outcome of** sub-point A, AND splitting would make sub-point B impossible to execute independently. | The causal chain between sub-points **is** the test point; splitting breaks the test semantics |

K1 is judged by **semantic dependency between sub-points**, not by keyword matching. Key distinctions:

- A case with a **shared setup step** followed by **independent test points** does NOT qualify for K1. Example: "Generate share links from 7 artifact types, then check each type list" — the "generate" step is a setup, but each artifact type's verification is independent. Each sub-case can include its own setup (generate one link → verify it) → split normally.
- A case where sub-point B **requires the specific outcome of sub-point A** DOES qualify for K1. Example: "Create item → rename item → verify renamed" — sub-point B cannot run without sub-point A's output.

**K1 test**: For each pair of sub-points, ask: "Can sub-point B include its own setup and execute from a clean state without sub-point A having run first?" If yes → no causal dependency → do not apply K1.

#### Three Implementation Levels (when `must-split`)

Choose the lowest-cost mechanism that preserves per-point observability:

| Level | Mechanism | Cost | Use when |
|-------|-----------|------|----------|
| **L1** Step-level reporting | Keep merged; insert explicit `Verify` after each sub-point; rely on platform's per-step pass/fail + continue-on-fail | Lowest | Platform supports per-step reporting; preferred for smoke |
| **L2** Data-driven template | Single rewrite template + N parameter rows; runtime expands to N executions | Medium | Sub-points share identical UI pattern (e.g., 9 buttons, 4 modes) |
| **L3** Physical split | Decompose into N independent rewritten cases | Highest | Sub-points need genuinely different setup / verification, or L1/L2 unavailable |

#### Decision Algorithm

```python
def triage(original_case):
    title_steps = (original_case.title + " " + original_case.steps).lower()
    matches_split = (has_enumeration(title_steps)         # R1
        or spans_multiple_features(title_steps)            # R2
        or matches_verify_all_N(title_steps)               # R3
        or has_independent_dimensions(title_steps))        # R4
    if matches_split:
        # K1 check: do sub-points have causal dependency?
        if has_causal_dependency(original_case):  # K1
            return "keep-merged"
        return "must-split"
    return "default"
```

For `must-split` cases, also record the proposed sub-case count and which rule fired — this drives whether to use L1, L2, or L3.

#### Sub-case ID Convention (when physically splitting, L3)

When you decompose one original case into N inputs, each sub-case must carry a stable ID that points back to its parent. Rules:

| Source | Sub-case ID format | Example |
|--------|-------------------|---------|
| Original CSV **has** an `ID` column | `<original_id>-<n>` | `STCAQA-817` → `STCAQA-817-1`, `STCAQA-817-2`, `STCAQA-817-3` |
| Original CSV **has no** `ID` column | `<group_seq>-<n>` | 3rd split group in the batch → `3-1`, `3-2` |

- `<n>` starts at **1** and increments by the split order (the order you list the sub-points in the original Steps).
- Sub-cases in the **same group must share the same prefix** — that prefix is the traceability key back to the parent.
- For L1 (in-step verification) and L2 (data-driven template) there is no physical split, so no new IDs are needed — the original `ID` is preserved as-is.

> Note: the current parser (`rewrite_from_doc/rewriter.py::_parse_csv`) does not read the `ID` column, but the CSV output formatter transparently passes through every original column. So adding an `ID` column to the input CSV is sufficient for the rewritten CSV to carry the sub-case ID. The JSONL output does not yet include `ID`; if you need traceability in JSONL, recover it by `(input_row_index → ID)` from the input CSV.

#### Sub-case Steps Writing Rules

When a case triggers `must-split`, the split stage must produce **complete sub-case CSVs with full Steps** — not just modified Titles. The rewrite pipeline depends on Steps to generate accurate fine-grained actions; without Steps, the LLM must infer the entire flow from the Title alone, which degrades quality for complex cases.

**Split output requirement**: Each sub-case row must have:
- `Title` — descriptive sub-case title
- `Description` — brief summary of what this sub-case verifies
- `Steps` — numbered, complete steps covering the full user journey for this sub-case

The Steps can be written manually or generated by LLM using the Title + Feature Doc as context. Either way, they must satisfy rules S1–S3 below.

| Rule | Principle | Anti-pattern |
|------|-----------|-------------|
| **S1 Full-flow** | Each sub-case must cover the complete user journey: **trigger → operate → verify outcome**. Do not stop at an intermediate state (e.g., content attached but not sent, UI opened but not interacted with). The last step should verify the *functional outcome* of the feature, not just that an element appeared. | Steps end at "Verify attachment added" without sending the message; steps end at "Verify UI opens" without exercising the feature |
| **S2 Single-path** | Steps must describe exactly one deterministic path. Do not use "A or B" / "X or press Back" / "if … otherwise …" forks — pick the path that fulfills the test intent (typically the happy path). Conditional handling belongs in the rewrite prompt, not in the decomposed input Steps. | "Take a photo or press Back"; "Verify dialog appears (or returns to home if cancelled)" |
| **S3 Inherit qualifiers** | Explicit qualifiers in the original Title (e.g., "actually used", "works correctly", "end-to-end", "not just tapped/selected") are constraints that apply to **every** sub-case. Each sub-case's Steps must demonstrably satisfy these qualifiers — if the original says "actually used", every sub-case must exercise the feature through to its functional result, not merely open its UI. | Original says "each must be actually used, not just tapped" but sub-case only opens a feature panel and navigates away |

**Self-check**: Before feeding sub-cases to the rewrite pipeline, verify each one against S1–S3. Read the Steps aloud and ask: "Does this sub-case *use* the feature end-to-end, or does it only *touch* part of the flow?"

> **Warning**: Passing Title-only input (copying Title into Steps) bypasses the split quality gate. The rewrite LLM may produce truncated or incomplete flows for complex cases. Always write proper Steps during the split stage.

### Batch & Model Tips

- **Dry run**: Set `max_rows: 3` to test with a small sample before processing the full CSV
- **Large batches**: For 200+ cases, consider reducing `max_workers` to avoid rate limiting
- **Model selection**: Different models produce different quality levels; `gpt5.4` is the default model
- **Screenshot**: Providing a start screenshot significantly improves step accuracy for the first few navigation steps
- **Iterative improvement**: If results are poor, improve the Feature Doc (especially `navigation_structure` and `detailed_function_introduction`) rather than tweaking the prompt

---

## Procedure

### Step 1: Environment Preparation

**Prerequisites:**

- An active Sico stack with LLM Hub configured (a model that supports text, ideally multimodal)
- `python` >= 3.11
- `uv`

From the skill root directory (`$SKILL_ROOT`), run:

```sh
uv sync
```

### Step 2: Validate Inputs

1. Verify all input files exist:
   - Test case CSV
   - Feature Doc (`.jsonl` or `.md`)
   - Action Space is auto-detected from `data/Action_Space.md` (override via `--action-space` if needed)
2. Check `config.env` for shared settings (model, endpoint, batch params). Defaults work out of the box for most setups.
3. Verify the output directory exists or will be created (defaults to `SICO_RESULT_DIR` env var, or `data/output/`).

### Step 3: Review Input Test Cases

Open the test case CSV and spot-check:

- **Columns present**: `Title`, `Description`, `Platform`, `Project Name`, `Steps`
- **Steps field**: Multi-line text with numbered steps (the parser splits on newlines)
- **Encoding**: UTF-8 (with or without BOM)
- **Row count**: Check total rows; if large (100+), consider setting `max_rows` for an initial test run
- **Split triage**: Apply the [Input Split Triage](#input-split-triage) to each case. Decompose every `must-split` case into N independent inputs **before** Step 4; otherwise the rewrite will produce a single oversized case that loses per-point observability.

### Step 4: Review Feature Doc Quality

Open the Feature Doc (`.jsonl` or `.md`) and verify it contains sufficient information for rewriting. Key sections the rewrite prompt relies on:

| Feature Doc Section | Why It Matters for Rewrite |
|---------------------|---------------------------|
| `navigation_structure` | The LLM uses this as a "map" to plan navigation paths between pages |
| `starting_state` | Defines what the agent sees on launch — rewritten cases must start from here |
| `detailed_function_introduction` | Concrete behavior of each sub-feature: what happens after each interaction |
| `sandbox_auth` | Test credentials for authentication flows |
| `user_flow` | Reference flow for judging step completeness |

If critical sections are missing, consider running the `testcase-gap-analysis` skill first.

### Step 5: Run the Pipeline

**Important**: The command must be run from the `rewrite-from-doc` skill directory (where `pyproject.toml` is). Use `uv run` to ensure dependencies are available. Input file paths should be **absolute** to avoid relative path issues.

```sh
cd skills/<id>/skills/rewrite-from-doc
uv sync  # first time only
uv run rewrite-from-doc \
  --input-csv /absolute/path/to/testcases.csv \
  --feature-doc /absolute/path/to/Feature_Doc.jsonl  # or .md
```

All other settings (model, endpoint, batch params) are read from `config.env` or built-in defaults. Override any setting via CLI arguments when needed.

#### Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--input-csv` | **yes** | — | Path to input test case CSV file |
| `--feature-doc` | **yes** | — | Path to Feature Doc (`.jsonl` or `.md`) |
| `--prompt-template` | no | `data/rewrite_prompt.md` | Path to the prompt template (auto-detected) |
| `--action-space` | no | `data/Action_Space.md` | Path to Action_Space.md (auto-detected) |
| `--start-image` | no | auto-detected if exists | Path to starting screenshot |
| `-o`, `--output-dir` | no | `SICO_RESULT_DIR` or `data/output/` | Directory for output files |
| `--sico-endpoint` | no | `SICO_ENDPOINT` or `http://localhost:8080` | Sico platform base URL |
| `--sico-app-name` | no | `SICO_APP_NAME` or `sico` | Sico app name for API path |
| `--sico-agent-instance-id` | no | `SICO_AGENT_INSTANCE_ID` | Agent instance ID for X-Sico-Context header |
| `--llmhub-model` | no | `LLMHUB_MODEL` or `gpt5.4` | LLM model identifier |
| `--max-rows` | no | `0` | Max rows to process (0 = all) |
| `--max-workers` | no | `3` | Concurrent LLM requests per batch |
| `--batch-size` | no | `20` | Batch size for LLM calls |
| `--output-format` | no | `csv` | Output format: csv or jsonl |
| `--timeout` | no | `300` | Per-request timeout in seconds |
| `--max-retries` | no | `3` | Max retry rounds for failed cases (0 = disable) |
| `--config` | no | — | Legacy: path to config.yaml (alternative to CLI args) |

The pipeline executes these stages automatically:
1. **Parse** — `TestCaseParser` reads CSV, validates columns, splits `Steps` into `steps_list`
2. **Load context** — Reads prompt template, Feature Doc, Action Space, and optional screenshot
3. **Build messages** — For each test case, constructs an LLM message with:
   - Prompt template (from `data/rewrite_prompt.md`)
   - `{feature_doc}` replaced with Feature Doc content
   - `{action_space}` replaced with Action Space content
   - `{testcase}` replaced with formatted test case (Title/Description/Platform/Steps)
   - Optional base64-encoded screenshot for multimodal prompting
4. **Call LLM** — Sends messages to Sico LLM Hub in batches:
   - Batch size: `batch.batch_size` (default 20)
   - Concurrent workers per batch: `batch.max_workers` (default 3)
   - Sleep between batches: `batch.sleep_between_batches` (default 3s)
   - Failed requests return `"0"` without blocking others
   - After each batch round, failed cases (`"0"`) are automatically retried up to `batch.max_retry_rounds` times (default 3)
5. **Save output** — `OutputFormatter` writes results to `output.path`

### Step 6: Review Output

The pipeline produces these output files in `data/output/`:

#### JSONL (always generated)

Filename: `rewritten_<prefix>_<timestamp>.jsonl`

Each line is a JSON object:
```json
{
  "original": {
    "title": "...",
    "description": "...",
    "platform": "...",
    "project_name": "...",
    "steps": "..."
  },
  "rewritten": {
    "test_case_id": "TC_EC_AUTOFILL_001",
    "title": "Verify EC autofill on Facebook login",
    "project_info": {
      "software": "Microsoft Edge",
      "feature": "ExpressCheckout",
      "platform": "Windows",
      "test_points": {
        "flow_path": "Happy Path",
        "verification_type": "Functional Check",
        "non_functional": "N/A"
      },
      "sub_tasks": ["Launch browser", "Navigate to site", "Verify autofill"]
    },
    "preconditions": ["Clean browser with no cached data"],
    "test_steps": [
      {
        "step": 1,
        "action": "Launch Microsoft Edge",
        "expected_result": "Edge opens with default new tab page"
      }
    ],
    "postcondition": "EC autofill successfully populated payment fields"
  }
}
```

#### CSV (or Excel)

Filename: `rewritten_<prefix>_<timestamp>.csv`

Contains all original columns plus:

| Added Column | Content |
|--------------|---------|
| `Model Output` | Raw LLM response text |
| `Rewritten Steps` | Formatted numbered step list extracted from JSON |
| `Created At` | Timestamp |

### Step 7: Quality Check

Review a sample of rewritten test cases against the [Six Quality Requirements](#six-quality-requirements) defined in Quality Methodology, then apply the [Post-rewrite Step-Count Check](#post-rewrite-step-count-check) to catch cases that exceeded GUI Agent reliability bounds after rewrite.

Common issues to watch for:
- `"0"` in Model Output column → LLM call failed (timeout or error); rerun those cases
- Empty `Rewritten Steps` → JSON parsing failed; check `Model Output` for malformed JSON
- Missing navigation steps → Feature Doc's `navigation_structure` may be incomplete

---

## Quality Methodology

This section defines the post-rewrite review criteria. Step 7 of the Procedure applies them on each batch's output. The two parts are an **intrinsic quality bar** (every rewritten case must pass these) and a **structural sanity check** (every rewritten case must fit GUI Agent execution bounds).

### Six Quality Requirements

Review a sample of rewritten test cases against the six quality requirements enforced by the prompt:

| # | Requirement | What to Check |
|---|-------------|---------------|
| 0 | **Grounding** | No hallucinated UI elements, button labels, or URLs not in the Feature Doc or original case |
| 1 | **Autonomy** | Starts from clean desktop, explicitly launches apps, no assumed prior state |
| 2 | **Granularity** | Each step maps to an Action Space action type; no vague composite instructions |
| 3 | **Verification** | `expected_result` must describe the **functional outcome** of the action (new UI / new page / new state / new data), not merely "button was tapped". **Forbidden pattern**: `Tap X → Press Back` loops with no Verify step in between — that only tests presence, not function. When the original Title says "work as expected" / "works correctly" / "functions correctly", every sub-point must include a Verify step that confirms the sub-point's specific functional UI (e.g., Camera → camera preview appears; Generate image → Composer enters image-generation mode with prompt hint). |
| 4 | **Reliability** | Realistic user flow, no redundant steps, deterministic path |
| 5 | **Intent Preservation** | Original test purpose preserved — no added/removed scenarios |

### Post-rewrite Step-Count Check

Scan every rewritten case for step count and re-apply the split decision now that concrete steps exist:

| Condition | Action |
|-----------|--------|
| `step_count > 20` AND triage label ≠ `keep-merged` | Flag for re-split: detect independent test points within the rewritten steps and decompose into multiple cases |
| `step_count > 30` (any case, including `keep-merged`) | Mandatory re-split — redesign the case; sequence is beyond GUI Agent reliability bounds |
| Multiple `Verify` steps that are order-independent inside one case | Strong physical-split signal — convert to L2 (data-driven) or L3 (physical split) |

This catches cases where the [Input Split Triage](#input-split-triage) missed the explosion (e.g., a benign-looking 5-step original that expanded to 35 fine-grained steps).

---

## Prompt & Schema Reference

The rewrite prompt (`data/rewrite_prompt.md`) instructs the LLM to follow a two-phase methodology:

### Phase 1: Understand
- Read Product Context (Feature Doc) — identify software, feature, platform, entry points
- Review starting screenshot — understand initial desktop state
- Read original test case — identify testing intent and purpose
- Combine all sources: Feature Doc + original case + screenshot + model knowledge

### Phase 2: Mentally Execute
- Walk through the entire operation as a real user, from the starting screenshot
- Track full navigation path including back-navigation and page transitions
- Consult `navigation_structure` as a map for page hierarchy
- Plan adaptive authentication using `sandbox_auth` credentials
- Identify missing steps, incorrect assumptions, or skipped transitions in the original
- Determine verification checkpoints and final assertion

### Output JSON Schema

```json
{
  "test_case_id": "TC_<PROJECT>_<FEATURE>_<SEQ>",
  "title": "Brief descriptive title",
  "project_info": {
    "software": "Software name",
    "feature": "Feature name",
    "platform": "Platform(s)",
    "test_points": {
      "flow_path": "Happy Path | Alternate Path | Error Path | Edge Case",
      "verification_type": "UI Check | Functional Check | Data Validation | Navigation Check | State Persistence",
      "non_functional": "Accessibility | Localization | Performance | Security | N/A"
    },
    "sub_tasks": ["Sub-task 1", "Sub-task 2"]
  },
  "preconditions": ["Precondition 1"],
  "test_steps": [
    {
      "step": 1,
      "action": "Action description",
      "expected_result": "Observable UI state after this action"
    }
  ],
  "postcondition": "Expected system state after all steps complete"
}
```

### Action Space

Every step must map to one of these GUI Agent action types:

| Action | Platform | Description |
|--------|----------|-------------|
| Click | All | Click on a specified UI element |
| Type | All | Type text into the currently focused input field |
| Scroll | All | Scroll within a specified area in a given direction |
| Launch | All | Launch a specified application |
| Wait | All | Wait for a page or element to finish loading |
| Drag | All | Drag an element from one position to another |
| Finished | All | Mark the task as completed with a summary |
| CallUser | All | Conclude the answer for an information-retrieval question |
| LongPress | Mobile | Long press on a specified UI element |
| PressBack | Mobile | Press the Back button or navigate back |
| PressHome | Mobile | Press the Home button |
| PressEnter | All | Press the Enter key |
| PressRecent | Mobile | Press the Recent button to view recent apps |
| Hover | Desktop | Move mouse cursor over an element without clicking |
| DoubleClick | Desktop | Double-click on a specified UI element |
| Hotkey | Desktop | Press a keyboard shortcut or key combination |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `No test cases found. Exiting.` | CSV has wrong column names or is empty | Verify columns: `Title`, `Description`, `Platform`, `Project Name`, `Steps` |
| Many `"0"` results | Model timeout or LLM Hub error | Check endpoint, reduce `batch_size`, or increase `timeout_seconds` |
| Empty `Rewritten Steps` column | Model returned non-JSON text | Check `Model Output` column; model may have included extra commentary |
| `Image not found` warning | `start_image_path` points to missing file | Verify path or remove `start_image_path` to use text-only mode |
| Steps lack navigation detail | Feature Doc missing `navigation_structure` | Enrich Feature Doc with full page hierarchy before rewriting |

---

## Multi-Feature Batch Rewrite

When input test cases span **multiple features**, each with its own Feature Doc (`.jsonl` or `.md`), the standard single-config pipeline cannot be used directly. Use `scripts/batch_rewrite_multi_feature.py` to automate the batch workflow.

### When to Use

- Input CSV contains cases from 2+ different features
- Each feature has its own Feature Doc (`.jsonl` or `.md`) in the rewrite data folder

### Quick Start

```bash
python scripts/batch_rewrite_multi_feature.py \
    --input data/input/smoke_test.csv \
    --analysis data/output/analysis.jsonl \
    --rewrite-root data/copilot_collect_rewrite \
    --output data/output/smoke_test_rewritten.csv \
    --splits splits.json
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--input` | Yes | Input test case CSV |
| `--analysis` | Yes | `analysis.jsonl` from `test-cases-analysis` skill (provides case→folder mapping) |
| `--rewrite-root` | Yes | Root of rewrite infrastructure (contains feature folders with Feature Docs) |
| `--output` | Yes | Output merged rewritten CSV path |
| `--splits` | No | JSON file with split definitions (see format below) |
| `--model` | No | Model name (default: `gpt5.4`) |
| `--base-config` | No | Base config YAML path (default: `config/copilot_config_common.yaml`) |

### Splits JSON Format

For cases that require physical splitting (L3), provide a JSON mapping from case ID to sub-case list:

```json
{
  "STCAQA-817": [
    ["Camera", "[Composer V4][Create mode] Tap + → Camera → use it", "1. Launch Copilot app\n2. Tap Message Copilot input field\n3. Tap the '+' button\n4. Tap 'Camera'\n5. Take a photo\n6. Verify photo attaches to Composer\n7. Type 'What is in this photo?' and send\n8. Wait for response\n9. Verify response references the photo"],
    ["Photos", "[Composer V4][Create mode] Tap + → Photos → select image", "1. Launch Copilot app\n2. Tap Message Copilot input field\n3. Tap the '+' button\n4. Tap 'Photos'\n5. Select an image from gallery\n6. Verify image attaches to Composer\n7. Type 'Describe this image' and send\n8. Wait for response\n9. Verify response describes the image"]
  ]
}
```

Each entry: `[label, title, steps]`.
- **label**: Short identifier for the sub-case
- **title**: Descriptive sub-case title
- **steps**: Complete numbered steps (newline-separated) covering trigger → operate → verify outcome. Must satisfy S1/S2/S3 rules.

Sub-case IDs are auto-generated as `<original_id>-<n>`.

> **Warning**: If `steps` is empty or omitted, the script falls back to using Title as Steps and prints a warning. This degrades rewrite quality — always provide proper Steps for split cases.

### Batch Procedure

1. **Feature classification** — Classify each input case into a feature/folder using `[Tag]` patterns or an existing `analysis.jsonl` from the `test-cases-analysis` skill.

2. **Split triage** — Apply the [Input Split Triage](#input-split-triage) rules. Expand `must-split` cases into sub-cases with IDs following the [Sub-case ID Convention](#sub-case-id-convention-when-physically-splitting-l3).

3. **Group by feature** — Partition the expanded cases into per-feature groups. Write each group to a separate input CSV with the required columns (`Title`, `Description`, `Platform`, `Project Name`, `Steps`). If the original CSV lacks `Description` or `Steps`, use the `Title` as a fallback for both.

4. **Run per feature** — Execute `rewrite-from-doc` for each feature using CLI arguments:
   ```sh
   uv run rewrite-from-doc \
     --input-csv <per-feature-input.csv> \
     --feature-doc <feature>/Rewriter/Feature_Doc.jsonl \  # or .md
     -o <per-feature-output-dir>/
   ```
   Shared settings (model, batch params, endpoint) come from `config.env`.

5. **Run sequentially** — Add a 2–3s delay between runs to avoid rate limiting. The `scripts/batch_rewrite_multi_feature.py` script automates steps 1–6.

6. **Merge outputs** — Collect all per-feature rewritten CSVs and merge into one final CSV. Preserve the `ID` / `Original ID` columns for traceability back to the input (including split sub-cases).

### Merge Output Schema

The merged CSV should include:

| Column | Description |
|--------|-------------|
| `ID` | Case ID (sub-case ID for split cases, e.g., `STCAQA-817-3`) |
| `Original ID` | Parent case ID (same as ID for non-split cases) |
| `Title` | Input title (post-split for sub-cases) |
| `Platform` | Platform |
| `Project Name` | Feature name |
| `Feature Folder` | Infra folder used for Feature Doc lookup |
| `Rewritten Steps` | Formatted rewritten steps from LLM |
| `Model Output` | Raw LLM JSON response |
