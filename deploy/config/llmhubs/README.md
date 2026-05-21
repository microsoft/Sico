# LLMHub builtin model configs

This directory holds YAML descriptors consumed by `ModelConfigLoader`
(`core/app/llmhubs/config_loader.py`). The loader scans every `*.yaml` /
`*.yml` file and **skips descriptors where the top-level `template: true`
is set**.

## Conventions

- Files named `*-template.yaml` are authoring templates shipped with the
  repository. They all carry `template: true` so an open-source user who
  does not yet have vendor credentials will not see dead models in the
  catalog on first boot.
- To activate a template, copy it (dropping the `-template` suffix) and
  fill in the placeholder endpoints / keys. For example:

  ```bash
  cp gpt5.4-template.yaml gpt5.4.yaml
  # then edit gpt5.4.yaml to point at your deployment
  ```

  Remove the `template: true` line (or set it to `false`) on the copy so
  the loader registers it as a builtin.
- Values may reference environment variables via `${VAR}` or
  `${VAR:-default}`. If a required env var is unset, the loader logs a
  warning and skips that descriptor — so shipping a template that uses
  `${OPENROUTER_API_KEY}` is safe even after you drop the suffix.

## Files

| File | Purpose |
| --- | --- |
| `model-template.yaml` | Fully-commented authoring reference (every field documented) |
| `gpt5.4-template.yaml` | Azure OpenAI GPT-5.4 (direct deployment) |
| `openrouter-gpt-5-4-template.yaml` | GPT-5.4 routed through OpenRouter |

For schema details and the full set of supported fields, see
`core/app/llmhubs/README.md`.

Runtime loader default directory: `core/config/llmhubs/` (override via the
`config_dir` constructor argument, or mount this directory to that path
inside the Core container).
