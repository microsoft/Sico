# test-cases-rewrite

Orchestrator skill for the test case rewrite pipeline. Coordinates sub-skills to analyze, triage, and rewrite test cases into GUI Agent executable format.

## Sub-Skills

- **extract-feature-doc** — Generate a feature-specific Feature_Doc.jsonl from knowledge, test cases, and LLM context
- **test-cases-analysis** — Analyze test cases: feature classification, coverage, quality scoring, HTML report
- **rewrite-from-doc** — Rewrite test cases using Feature Doc and Action Space context

## Quick Start

```sh
# Install sub-skill dependencies
cd skills/test-cases-analysis && uv sync
cd skills/rewrite-from-doc && uv sync
```

See `SKILL.md` for the full workflow and user interaction guide.
