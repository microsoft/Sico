# Skill Examples

This group packages a local skill directory or zip file, uploads it as a
project asset, and registers it through `POST /api/sico/skills`.

## Scripts

- `python3 -m examples.skills.register_skill_from_path`

## Environment

- `TOKEN`: required
- `PROJECT_ID`: defaults to `1`
- `AGENT_ID`: optional
- `SKILL_PATH`: optional; defaults to `backend/internal/embeddata/skills/android-tester-skill`

If `SKILL_PATH` points at a directory, the script zips it in memory before
uploading it.