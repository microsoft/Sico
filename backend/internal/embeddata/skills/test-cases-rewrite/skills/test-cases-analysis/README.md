# Test Cases Analysis

Analyze incoming test cases, produce a structured intermediate document (JSONL),
then render bilingual (EN + CN) HTML reports.

## Report Types

- **executability** — Feature-level infrastructure & sandbox feasibility assessment
- **prerequisite** — External prerequisite checklist for test execution
- **quality** — Pre-rewrite quality check (structural + description quality)

## Architecture

```
Stage 1 (fixed code)     Stage 2 (LLM)              Stage 3 (fixed code)
─────────────────────    ───────────────────────     ──────────────────────
scan_infra.py            LLM reads CSV + infra       render command
  reads rewrite_root     + sandbox_limitations        reads analysis.jsonl
  → infra.json           → analysis.jsonl             → HTML (en + cn) + TSV
```

## Usage

```bash
# Stage 1: Scan infrastructure (if doing executability analysis)
python -m report.scan_infra --root <rewrite_root> --output infra.json

# Stage 3: Render reports from analysis.jsonl
python -m report.render --input analysis.jsonl --infra infra.json --type both --output <dir>/
python -m report.render --input analysis.jsonl --type quality --output <dir>/
python -m report.render --input analysis.jsonl --infra infra.json --type all --output <dir>/
```

## Dependencies

Pure Python stdlib — no external packages required.
