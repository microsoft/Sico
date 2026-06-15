# rewrite-from-doc

CLI tool for batch-rewriting human-authored test cases into GUI Agent
executable format using the Sico LLM Hub.

## Prerequisites

- `python` >= 3.11
- `uv`
- A running Sico stack with at least one LLM model registered

## Installation

From the skill directory:

```sh
uv sync
```

## Usage

```sh
rewrite-from-doc --config config.yaml
```

Or with individual arguments:

```sh
rewrite-from-doc \
  --input-csv testcases.csv \
  --prompt-template data/rewrite_prompt.md \
  --feature-doc Feature_Doc.jsonl \
  --action-space Action_Space.md \
  --output-dir output/ \
  --sico-endpoint http://localhost:8080 \
  --llmhub-model gpt5.4
```

See `SKILL.md` for full documentation.
