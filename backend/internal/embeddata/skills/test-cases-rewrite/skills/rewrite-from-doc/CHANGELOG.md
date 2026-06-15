# Changelog

## 2026-05-19

### Added

- **Multi-Feature Batch Rewrite section** — Documents per-feature grouping, config generation, sequential pipeline execution, and output merging for CSVs spanning multiple features. References `scripts/batch_rewrite_multi_feature.py`.
- **Input CSV Normalization table** — Covers common format mismatches (missing columns, column name variants, TSV, BOM, empty Platform) with recommended actions.
- **Splits JSON `steps` field** — Split definitions now support a third element `[label, title, steps]` with complete numbered test steps per sub-case.

### Changed

- **K1 Causal dependency rule refined** — Shared setup + independent test points (e.g., "generate 7 share links then check each") no longer qualifies as K1. Each sub-case can include its own setup → split normally.
- **Sub-case Steps Writing Rules strengthened** — Explicitly requires split stage to produce full Steps (not just Title). Warns that Title-only input degrades rewrite quality. Steps can be human-written or LLM-generated but must satisfy S1/S2/S3.
- **`batch_rewrite_multi_feature.py`** — Uses `_steps` from splits JSON instead of copying Title to Steps column. Prints WARNING for sub-cases missing Steps.

## 2026-05-18

### Added

- New H4 **Sub-case Steps Writing Rules** under `Input Split Triage`, after `Sub-case ID Convention`. Defines three rules for writing decomposed sub-case Steps:
  - **S1 Full-flow**: Each sub-case must cover the complete user journey (trigger → operate → verify outcome); must not stop at an intermediate state.
  - **S2 Single-path**: Steps must describe exactly one deterministic path; no "A or B" forks — pick the path that fulfills the test intent.
  - **S3 Inherit qualifiers**: Explicit qualifiers in the original Title (e.g., "actually used", "not just tapped") apply to every sub-case; each sub-case's Steps must demonstrably satisfy them.
  - Includes a self-check prompt for verifying sub-cases against S1–S3 before feeding to the rewrite pipeline.

### Changed

- **K1 Override Rule rewritten**: Replaced keyword-matching approach (`warm start`, `history`, `back to`, etc.) with a **causal dependency** principle. K1 now applies only when sub-point B's setup or verification depends on the outcome of sub-point A (e.g., "undo → redo → verify"). Cases that repeat the same pattern across independent dimensions (e.g., "warm start from Discover" + "warm start from Chat UI") no longer trigger K1 and follow R1–R4 normally. Added a self-test: "Can sub-point B execute from a clean state without sub-point A having run first?"
- **Decision Algorithm updated**: K1 check moved from a pre-emptive keyword gate to a conditional check inside the `must-split` branch, ensuring R1–R4 are evaluated first.

## 2026-05-15

### Added

- **Verification depth clause in Quality Requirement #3 (Verification)**: `expected_result` must describe the **functional outcome** of the action, not merely tap success. Explicitly forbids the `Tap X → Press Back` shallow loop pattern when the original Title contains intent keywords ("work as expected", "works correctly", "functions correctly"). Each sub-point must include a Verify step confirming the sub-point's specific functional UI.

- New top-level section **Pre-rewrite Split Triage** between `Pre-flight Checklist` and `Procedure`. Defines:
  - Split rules R1-R4 (Enumeration / Cross-team / Verify-all-N / Independent dimensions) — keyword-based signals observable on the original Title + Steps.
  - Override rule K1 (Stateful flow) — overrides R1-R4 to keep cases like warm-start / persist / history merged.
  - Three implementation levels L1 (step-level reporting) / L2 (data-driven template) / L3 (physical split) for choosing the lowest-cost mechanism.
  - Decision algorithm pseudocode for batch triage.
- New top-level section **Quality Methodology** between `Procedure` and `Prompt & Schema Reference`, consolidating the `Six Quality Requirements` table and the `Post-rewrite Step-Count Check`.
- New H4 **Sub-case ID Convention (when physically splitting, L3)** under `Input Split Triage`. Defines:
  - `<original_id>-<n>` when the input CSV has an `ID` column (e.g. `STCAQA-817-1`, `STCAQA-817-2`).
  - `<group_seq>-<n>` when the input CSV has no `ID` column.
  - `<n>` starts at 1 and follows the split order; sub-cases in the same group must share the same prefix.
  - Applies only to L3 (physical split); L1/L2 preserve the original ID as-is.
  - Documents the parser limitation: `testcase_parser.py` does not read `ID`, but the CSV formatter passes through original columns, so the rewritten CSV does carry sub-case IDs. JSONL output has no `ID` (recover via input row index).

### Changed

- **Document restructured to pair "pre-flight" and "post-flight" methodology sections** for clearer flow. All content preserved; only relocated.
  - Merged `Inputs` + `Pre-flight Checklist` + `Pre-rewrite Split Triage` + `Batch Processing Tips` into a unified `## Pre-flight` parent with four sub-sections: `Inputs`, `Config Checklist`, `Input Split Triage`, `Batch & Model Tips`.
  - Renamed `Pre-flight Checklist` → `Config Checklist` (now H3 under Pre-flight).
  - Renamed `Pre-rewrite Split Triage` → `Input Split Triage` (now H3 under Pre-flight; its sub-headings demoted to H4).
  - Renamed `Batch Processing Tips` → `Batch & Model Tips` and moved into Pre-flight (was the trailing section).
  - Moved `Six Quality Requirements` table and `Post-rewrite Step-Count Check` out of `Step 6` into the new `Quality Methodology` H2 section; Step 6 now contains a brief pointer + the "Common issues to watch for" bullets.
  - Renamed `Rewrite Quality Requirements Reference` → `Prompt & Schema Reference` (content unchanged: Phase 1, Phase 2, Output JSON Schema, Action Space).
- **Step 2 (Review Input Test Cases)**: Added a bullet pointing to the new Split Triage section, instructing decomposition of `must-split` cases before Step 4.
- **Step 6 (Quality Check)**: Added a `Post-rewrite Step-Count Check` subsection that re-applies split decisions after rewrite using actual step counts (>20 flag, >30 mandatory re-split).
