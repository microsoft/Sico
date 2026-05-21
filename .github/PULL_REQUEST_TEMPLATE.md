## Summary

Describe what changed and why.

## Validation

- [ ] `make precommit-run`
- [ ] `cd backend && go test ./...`
- [ ] `cd core && uv run pytest`
- [ ] Frontend build/lint, if working from a frontend source checkout
- [ ] Not run; explain below

## Checklist

- [ ] Linked relevant issues or explained why there is no issue.
- [ ] Updated docs and examples where behavior changed.
- [ ] Updated `CHANGELOG.md` under `## [Unreleased]` for user-facing changes.
- [ ] Regenerated and committed generated files after proto, Wire, or OpenAPI changes.
- [ ] Confirmed no secrets, tokens, credentials, or sensitive logs are included.

## Notes for reviewers

Call out risky areas, migration notes, screenshots, or intentionally skipped checks.