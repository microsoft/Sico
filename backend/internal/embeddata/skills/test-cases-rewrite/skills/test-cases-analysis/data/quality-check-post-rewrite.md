# Post-Rewrite Quality Validation

> Stage 2 — Verify that Rewrite output meets the GUI Agent execution standard.
> Pre-rewrite check: see [quality-check-pre-rewrite.md](quality-check-pre-rewrite.md).

---

## Purpose

Verify that the Rewrite output meets the GUI Agent execution standard and determine whether to proceed to execution.

---

## Quality Criteria

### Group A · Structural Completeness

Same as Pre-Rewrite. All elements must be present.

| ID | Check Item | Pass Requirement |
| --- | --- | --- |
| A-1 | ID / Number | Has a unique identifier |
| A-2 | Preconditions | Preconditions are explicitly stated |
| A-3 | Steps | Contains at least one executable step; not a single summary sentence |
| A-4 | Expected Result | Each key checkpoint has an observable, verifiable expected result |
| A-5 | App / Platform | Target application and platform are explicitly stated |

### Group B · Description Quality

Same criteria as Pre-Rewrite, but **all items are now blocking** (not warnings).

| ID | Check Item | Pass Requirement | Failing Example |
| --- | --- | --- | --- |
| B-1 | Grounding | References visible UI elements (text / position / icon); avoids abstract wording | "verify it works correctly", "check the feature" |
| B-2 | Autonomy | Starts from a clean state; all preconditions are explicit; no reliance on implicit state | "continue from the previous step", implicitly assumes logged-in / cached state |
| B-3 | Granularity | Each step corresponds to one atomic action (Click / Type / Scroll, etc.) | "go to settings and enable notifications and modify" |
| B-4 | Reliability | Main path is deterministic; no randomness; inputs and data are reproducible | "enter any text", "randomly select an option" |

---

## Guiding Principle

**Strict enforcement**: both Group A and Group B must pass. Since the Rewrite's responsibility is to resolve Group B issues, all Group B items should pass after Rewrite.

---

## Severity by Group

| Group | Severity | Action on Failure |
| --- | --- | --- |
| Group A | Block | Rewrite anomaly; return for regeneration with alert |
| Group B | Block | Rewrite did not achieve its goal; return for regeneration |

---

## Decision Matrix

| Group A | Group B | Decision |
| --- | --- | --- |
| Pass | Pass | Passes validation; proceed to execution |
| Pass | Fail | Return to Rewrite (with failed B items as input) |
| Fail | — | Anomalous; return to Rewrite with alert |

---

## Cross-Stage Severity Comparison

| Check Item | Pre-Rewrite (Stage 1) | Post-Rewrite (Stage 2) |
| --- | --- | --- |
| A-1 ~ A-5 | Block | Block |
| B-1 Grounding | Warning | **Block** |
| B-2 Autonomy | Warning | **Block** |
| B-3 Granularity | Warning | **Block** |
| B-4 Reliability | Warning | **Block** |

Key difference: Group B is a soft warning in Stage 1 but a hard requirement in Stage 2.

---

## Detection Reliability Reference

| Check Item | Algorithm Reliability | Implementation Suggestion |
| --- | --- | --- |
| A-1 ~ A-5 | High | Field presence validation |
| B-3 Granularity | High | Syntactic analysis; detect compound verbs and conjunctions |
| B-1 Grounding | Medium | Abstract verb dictionary matching + semantic analysis |
| B-4 Reliability | Medium | Randomness / network dependency keyword matching |
| B-2 Autonomy | Low | Implicit assumption detection; may have false negatives |
