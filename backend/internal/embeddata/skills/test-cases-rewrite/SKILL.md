---
name: test-cases-rewrite
description: "Analyze and rewrite test cases into GUI Agent executable format. Accepts CSV files or inline case text. The pipeline searches project knowledge for feature docs, runs quality/feasibility analysis with HTML reports, and rewrites cases through the rewrite-from-doc CLI tool. IMPORTANT: Always read this skill's SKILL.md before processing any test case request — do not generate analysis or rewrite output from your own reasoning."
argument-hint: "Provide the input test case file (CSV/TSV) and optionally the target feature name"
---

# Skill: Test Cases Rewrite Pipeline

## Purpose

This is an **orchestrator skill** that coordinates sub-skills to deliver the full test case rewrite workflow. It automatically discovers existing project knowledge, generates missing documentation, and rewrites test cases into GUI Agent executable format.

**Core principle**: Always search project knowledge first before generating anything from scratch.

**Mandatory rule**: When rewriting test cases, you MUST use the `rewrite-from-doc` pipeline via `run_command`. Do NOT rewrite test cases by generating the output directly from your own reasoning. The pipeline ensures consistent quality, grounding in Feature Doc, and structured output format. Even for a single test case, always run the pipeline.

---

## Available Sub-Skills

Read each sub-skill's `SKILL.md` for detailed instructions before executing its phase.

| Sub-Skill | Directory | Purpose |
|-----------|-----------|---------|
| **extract-feature-doc** | `skills/extract-feature-doc/` | Generate a feature-specific Feature_Doc.jsonl by synthesizing information from project knowledge, test cases, LLM knowledge, and web search |
| **test-cases-analysis** | `skills/test-cases-analysis/` | Analyze input test cases: feature classification, sandbox assessment, coverage analysis, quality scoring, and bilingual HTML report generation |
| **rewrite-from-doc** | `skills/rewrite-from-doc/` | Rewrite coarse-grained test cases into fine-grained GUI Agent executable steps using Feature Doc and Action Space context |

---

## User Interaction Guide

**Tone & style**: You are talking to testers and operators. Use natural, conversational language — no bullet-point walls, no formulaic "key = value" patterns. Summarize findings in short paragraphs. Never expose internal workflow labels (Phase 0/1/2/3, Stage 1/2/3) to the user; those are for your own execution reference only.

**Output rules**:
- Unless the user explicitly asks for Chinese or bilingual output, generate and deliver **English-only** reports (`--lang en`).
- Do NOT dump intermediate artifacts (analysis JSONL, infra JSON, raw LLM output) into the conversation. Only deliver the **final HTML report links** and a short natural-language summary.
- Intermediate files (analysis.jsonl, infra.json, per-feature CSVs) stay in the workspace — the user can access them via the file links if needed, but you should not paste their contents in chat.
- When uploading reports via the `report` tool, upload **HTML files only**. Do NOT upload TSV files — they are machine-readable byproducts and not needed in the conversation.
- After rewrite: upload the **rewritten CSV** via the `report` tool. **If a Feature Doc was generated during this session, you MUST also convert it to MD using `jsonl_to_md.py` and upload the Feature Doc MD alongside the CSV.** Do NOT upload JSONL, raw model output JSON, or intermediate per-feature CSVs — the JSONL is an internal pipeline artifact, only the MD is user-facing.

### Default Conversation Flow

When a user sends test cases, follow this conversational flow step by step. **Do not skip the confirmation checkpoints.**

**Input formats accepted**: The user may provide test cases in any of these ways:
- A CSV/TSV file attachment
- One or more case IDs + titles pasted as text in the message (e.g., "STCAQA-6465, [Chat UI][Sign In Button] When the user is not signed in...")
- A case ID only (e.g., "STCAQA-6465") — look it up from project knowledge

When the user provides **text instead of a file**, you MUST assemble a temporary CSV with the required columns (`Title`, `Description`, `Platform`, `Project Name`, `Steps`) using the `write` tool before running the pipeline. Use the case title as both `Title` and `Description`, and leave `Steps` as the title text (the pipeline will handle expansion). Do NOT skip the pipeline just because no file was uploaded.

#### 1. Receive Test Cases → Confirm Scope

When the user provides test cases (file or text) **without explicitly saying "skip analysis"** or "just rewrite":

> **Say to user**: "Got it — I see [N] test cases in your file. I'd recommend running a quick analysis first to check sandbox compatibility, input quality, and whether any cases need splitting. This usually catches issues early and makes the rewrite smoother. Want me to run the analysis before rewriting?"

| User Response | Action |
|---------------|--------|
| Yes / OK / sure / proceed | → Search project knowledge, then run analysis |
| No / skip / just rewrite | → Search project knowledge, then rewrite directly |
| Just analyze / analysis only | → Search project knowledge, run analysis, stop after report |

> **Note**: "skip analysis" means skip the analysis step only — the rewrite pipeline is NEVER optional. You must always run the `rewrite-from-doc` CLI tool; do not substitute it with your own rewrite.

#### 2. After Analysis → Present Summary + Ask About Rewrite

Once the analysis report is generated, present a **natural summary** to the user. Do not use a rigid bullet list — write a short paragraph that highlights what matters.

> **Example** (adapt based on actual numbers):
>
> "Analysis done. Out of [N] cases covering [features], [X] look good and are ready to rewrite. [Y] cases have input quality issues that may affect results, and [Z] could benefit from splitting into smaller cases. On the sandbox side, [N] cases can't run in the current environment — they require capabilities beyond what the sandbox supports. Full report is here: [link]. Want to proceed with the rewrite?"

**Delivering reports**: Use the `report` tool to upload rendered HTML/CSV artifacts, then present the returned HTTP links to the user so they can open reports directly in a browser.

| User Response | Action |
|---------------|--------|
| Yes / rewrite / proceed | → Run the rewrite pipeline |
| No / not now / let me review | → Stop, let user review the report |
| Rewrite only [feature X] | → Run the rewrite pipeline for specified feature(s) only |

#### 3. After Rewrite → Report Results

After rewrite completes, present the outcome conversationally:

> **Example**: "Rewrite finished — [N] cases rewritten successfully, [M] failed. Here are the results: [rewritten CSV link]. I also generated a Feature Doc for [feature]: [Feature Doc MD link]. Want me to spot-check a few samples, or are we good?"

**Delivering outputs**: Use the `report` tool to upload the rewritten CSV **and** the Feature Doc MD (if one was generated). Both must be uploaded and both links must appear in your response. Do NOT upload JSONL, raw model output, or intermediate files. Always upload before reporting links — do not construct URLs manually.

---

## Full Pipeline Workflow

### Phase 0: Knowledge Discovery

**Goal**: Find feature-specific Feature Doc from project knowledge before doing anything else.

Feature Doc is **per-feature** — each feature (e.g., "Search", "Composer", "Read Aloud") has its own Feature Doc describing that feature's UI structure, navigation, and behavior. You must find the Feature Doc that matches the **specific feature** of the test cases being rewritten, not just any Feature Doc in knowledge.

#### Step 0.1: Identify Target Features

Extract feature keywords from the test cases:
- Parse `[Tag]` patterns in titles (e.g., `[Search][Suggestion]` → feature = "Search")
- If no tags, infer from title content and ask the user to confirm

#### Step 0.2: Search Project Knowledge

1. Call `context()` to get the knowledge index (list of all knowledge documents with id, name, tags, and optionally summary)
2. For each target feature, search the knowledge list:

   **Matching strategy (in priority order):**

   | Priority | Match Type | How |
   |----------|-----------|-----|
   | P1 | **Name exact match** | Knowledge document name contains the feature name (e.g., name contains "Search" for feature "Search") |
   | P2 | **Tag match** | Knowledge tags contain the feature name or related terms |
   | P3 | **Summary content match** | Read `knowledge/{id}/summary.md` — look for feature-related terms: feature name, sub-feature names, UI element names from test case titles |

3. For P3 matches or when P1/P2 returns multiple candidates, read the document content to verify it's a **Feature Doc** (should contain fields like `navigation_structure`, `detailed_function_introduction`, `starting_state`)

#### Step 0.3: Decision

| Result | Next Phase |
|--------|------------|
| Found matching Feature Doc for the feature | → **Phase 2** (rewrite-from-doc) directly |
| Found partial/related knowledge but no complete Feature Doc | → **Phase 1** (extract Feature Doc), using found knowledge as primary source |
| No relevant knowledge found | → **Phase 1** (extract Feature Doc), relying on test case content + LLM knowledge + web search |

**Report to user**: "I found/didn't find a Feature Doc for feature [X] in project knowledge. [Proceeding with rewrite / Will generate one first]."

---

### Phase 1: Extract Feature Doc (when not found in knowledge)

1. Read `skills/extract-feature-doc/SKILL.md` for detailed instructions
2. Gather context from partial knowledge matches, test case content, LLM knowledge, and web search
3. Synthesize a feature-specific `Feature_Doc.jsonl` following the schema in the sub-skill
4. Validate completeness against test case coverage
5. Convert to Markdown using `jsonl_to_md.py` in the extract-feature-doc skill directory
6. Save to workspace for the rewrite pipeline

---

### Phase 2: Analysis (test-cases-analysis) — Optional

Run this phase when the user wants quality analysis or when processing large batches.

1. Read `skills/test-cases-analysis/SKILL.md` for detailed instructions
2. Run Stage 1 (scan_infra) to discover rewrite infrastructure
3. Run Stage 2 (LLM analysis) to produce `analysis.jsonl`
4. Run Stage 3 (render) to produce the **unified** HTML report:
   ```sh
   python -m report.render --input analysis.jsonl --type unified --output <dir>/
   ```
   This produces a single HTML dashboard with 4 tabs (Ready / Blocked / Prerequisite / Low Quality). Use `--infra infra.json` if infra data is available. Only generate specialized reports (`--type executability`, `quality`, etc.) if the user explicitly requests them.
5. **Present the report to the user** and ask for review before proceeding

#### Review Checkpoint

After analysis, present key findings to the user:

- Cases flagged as `must-split` — confirm split decisions
- Cases with `sandbox.blocked = true` — may need to be excluded
- Cases with `quality.decision = needs_rewrite_of_input` — original Steps may need improvement before rewrite
- Cases with `coverage.status = no_infra` — no matching rewrite infrastructure

**Ask the user**: "Analysis complete. Here are the findings: [summary]. Shall I proceed with the rewrite phase, or do you want to address any issues first?"

---

### Phase 3: Rewrite (rewrite-from-doc)

> **⚠️ Do NOT skip the pipeline**: Even for a single test case, always run `rewrite-from-doc` via `run_command`. Do not manually construct the rewritten JSON output. The pipeline applies the prompt template, Feature Doc context, Action Space constraints, and retry logic that manual rewriting cannot replicate.

1. Read `skills/rewrite-from-doc/SKILL.md` for detailed instructions
2. Ensure Feature Doc is available (from Phase 0 knowledge discovery or Phase 1 generation)
3. Apply split triage results if Phase 2 was run (decompose `must-split` cases)
4. Run the rewrite pipeline with **absolute paths**:
   ```sh
   cd skills/<id>/skills/rewrite-from-doc
   uv run rewrite-from-doc \
     --input-csv /absolute/path/to/cases.csv \
     --feature-doc /absolute/path/to/Feature_Doc.jsonl
   ```
   All other settings (model, endpoint, batch params) are read from `config.env` or built-in defaults. Pass `-o /path/to/output/` only if the default `SICO_RESULT_DIR` is not appropriate.
5. If a Feature Doc was generated during this session (Phase 1), convert it to Markdown:
   ```sh
   python skills/<id>/skills/extract-feature-doc/jsonl_to_md.py /absolute/path/to/Feature_Doc.jsonl
   ```
6. Upload **both** the rewritten CSV **and** the Feature Doc MD via the `report` tool, then present both links to the user
7. Review output quality and present results to the user

---

## Quick Decision Flowchart

```
User provides test cases
│
├─ Phase 0: Search project knowledge for feature's Feature Doc
│  │
│  ├─ FOUND → Phase 3: Rewrite directly
│  │
│  └─ NOT FOUND → Phase 1: Extract Feature Doc
│     │  (knowledge partial matches > test case content > LLM knowledge > web search)
│     │
│     └─ Feature Doc generated → Phase 3: Rewrite
│
├─ (Optional) Phase 2: Analysis — run if user wants quality report or batch triage
│
└─ Phase 3: Rewrite using rewrite-from-doc sub-skill
```

---

## Environment Setup

Each sub-skill has its own `pyproject.toml`. Install dependencies separately:

```sh
cd skills/test-cases-analysis && uv sync
cd skills/rewrite-from-doc && uv sync
```

---

## Adding New Sub-Skills

This orchestrator is designed for extensibility. To add a new sub-skill:

1. Create a new directory under `skills/` with its own `SKILL.md`, `pyproject.toml`, and implementation
2. Update the "Available Sub-Skills" table above
3. Update the pipeline workflow as needed
