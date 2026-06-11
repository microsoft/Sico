# Pre-Rewrite Quality Check

> Stage 1 — Evaluate test case quality before entering the Rewrite pipeline.
> Post-rewrite validation: see [quality-check-post-rewrite.md](quality-check-post-rewrite.md).

---

## Purpose

Identify whether a test case has quality issues that would block rewriting, and determine:

- Whether it can enter the Rewrite pipeline
- Whether Rewrite is needed
- Which specific issues the Rewrite should address

---

## Quality Criteria

### Group A · Structural Completeness

Group A checks the structural elements of a test case. All elements must be present.

| ID | Check Item | Pass Requirement |
| --- | --- | --- |
| A-1 | ID / Number | Has a unique identifier |
| A-2 | Preconditions | Preconditions are explicitly stated |
| A-3 | Steps | Contains at least one executable step; not a single summary sentence |
| A-4 | Expected Result | Each key checkpoint has an observable, verifiable expected result |
| A-5 | App / Platform | Target application and platform are explicitly stated |

### Group B · Description Quality

Group B checks whether the test case description meets GUI Agent execution requirements.

| ID | Check Item | Pass Requirement | Failing Example |
| --- | --- | --- | --- |
| B-1 | Grounding | References visible UI elements (text / position / icon); avoids abstract wording | "verify it works correctly", "check the feature" |
| B-2 | Autonomy | Starts from a clean state; all preconditions are explicit; no reliance on implicit state | "continue from the previous step", implicitly assumes logged-in / cached state |
| B-3 | Granularity | Each step corresponds to one atomic action (Click / Type / Scroll, etc.) | "go to settings and enable notifications and modify" |
| B-4 | Reliability | Main path is deterministic; no randomness; inputs and data are reproducible | "enter any text", "randomly select an option" |

---

## Guiding Principle

**Lenient entry, strict exit**: only structural issues block the pipeline; description quality issues are flagged but do not block. The Rewrite stage is responsible for resolving description quality issues and should not be gated prematurely.

---

## Severity by Group

| Group | Severity | Action on Failure |
| --- | --- | --- |
| Group A | Block | Return to user for revision; do not enter Rewrite |
| Group B | Warning | Flag as Rewrite task list items; do not block the pipeline |

---

## Decision Matrix

| Group A | Group B | Decision |
| --- | --- | --- |
| Pass | Pass | Ready for execution; Rewrite is optional |
| Pass | Has Warnings | Recommended to enter Rewrite |
| Fail | — | Must fix Group A issues before proceeding |

---

## Detection Reliability Reference

| Check Item | Algorithm Reliability | Implementation Suggestion |
| --- | --- | --- |
| A-1 ~ A-5 | High | Field presence validation |
| B-3 Granularity | High | Syntactic analysis; detect compound verbs and conjunctions |
| B-1 Grounding | Medium | Abstract verb dictionary matching + semantic analysis |
| B-4 Reliability | Medium | Randomness / network dependency keyword matching |
| B-2 Autonomy | Low | Implicit assumption detection; may have false negatives |
