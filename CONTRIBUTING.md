# Contributing to Sico

Thanks for your interest in contributing! This project is MIT-licensed: by
submitting a pull request you agree that your contribution will be distributed
under the same terms.

## Start here

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before participating. If
you want to report a security vulnerability, do not open a public issue; follow
the private process in [SECURITY.md](SECURITY.md).

For local setup, build commands, code generation, and troubleshooting, use the
[Development guide](docs/development.md) as the canonical reference. For simply
running Sico locally, start with the [Quick Start](docs/quickstart.md).

## Ways to contribute

Contributions of all kinds are welcome:

- Bug reports with clear reproduction steps.
- Feature ideas grounded in a concrete workflow or user need.
- Documentation fixes, examples, and setup improvements.
- Code changes that are focused, tested, and easy to review.

Before opening an issue, please search existing issues and use the most relevant
template. Include enough context for maintainers to reproduce or evaluate the
request.

## Developer setup

Install the default contributor toolchain and register the git pre-commit hook:

```bash
make setup
```

If you work on Kind deployment or Helm charts, also install Helm, `kubectl`, and
`kind`:

```bash
make setup-kind
```

Verify your environment without installing anything:

```bash
make setup-check
```

The development guide lists platform-specific installer behavior, Make targets,
service-specific commands, and troubleshooting notes.

## License headers

Every new source file (Go, Python, TypeScript, JavaScript, proto, shell, YAML,
Dockerfile, ...) must carry the MIT header. The pre-commit hook adds it
automatically. Generated files are intentionally excluded; see the
[Development guide](docs/development.md#license-headers) and
[pre-commit configuration](.pre-commit-config.yaml) for the exact ignore list.

## Commit & PR

1. Fork the repo and create a feature branch.
2. Keep the change focused and include tests or documentation when behavior
   changes.
3. Run `make precommit-run` before you push.
4. Make sure the relevant test suites pass:
   - Backend: `cd backend && go test ./...`
   - Core:    `cd core && uv run pytest`
5. Update [CHANGELOG.md](CHANGELOG.md) under `## [Unreleased]` if the change
   is user-facing (new feature, behavior change, bug fix, security fix,
   deprecation, or removal). Pure refactors / CI / docs-only changes can skip
   this.
6. Open a pull request against `main`. Describe the change, link relevant
   issues, and call out any intentionally skipped checks.

If your change touches generated code, regenerate from the source definition and
commit both the source and generated outputs. For example, protobuf changes start
in `proto/`, Wire changes start in `wire.go`, and OpenAPI changes start in
Backend handler annotations.

### Commit message style

We follow [Conventional Commits](https://www.conventionalcommits.org/). This
keeps `git log` scannable and lets us adopt automated release tooling (e.g.
`release-please`) later without rewriting history.

Format:

```
<type>(<optional scope>): <short summary>
```

Common types:

| Type       | When to use                                                  |
| ---------- | ------------------------------------------------------------ |
| `feat`     | New user-facing feature                                      |
| `fix`      | Bug fix                                                      |
| `docs`     | Documentation only                                           |
| `refactor` | Code change that neither adds a feature nor fixes a bug      |
| `perf`     | Performance improvement                                      |
| `test`     | Adding or fixing tests                                       |
| `build`    | Build system, dependencies, Docker, Helm                     |
| `ci`       | CI configuration                                             |
| `chore`    | Routine maintenance (version bumps, lint rule tweaks, ...)   |

Scopes mirror the top-level domains (e.g. `backend`, `core`, `frontend`,
`proto`, `sandbox`, `rbac`, `llmhubs`, `conversation`). Scopes are optional.

For a breaking change, append `!` after the type/scope **and** add a
`BREAKING CHANGE:` footer describing the migration:

```
feat(rbac)!: require explicit policy for sandbox endpoints

BREAKING CHANGE: deployments must add a `sandbox:*` policy group before
upgrading; see docs/migrations/0.3.md.
```

Examples:

```
feat(sandbox): add HMAC-based client auth middleware
fix(core): handle empty choices array in llmhubs adapter
docs: clarify reverse gRPC port in quickstart
chore(deps): bump gorm to v1.26
```

## Code of conduct

Please be respectful. This project follows the
[Contributor Covenant](https://www.contributor-covenant.org/): be kind,
assume good faith, keep discussions on-topic. See
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for details.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. Follow the
process in [SECURITY.md](SECURITY.md).

## More

For the full documentation set (overview, architecture, quickstart, and
deeper development guide), see [docs/](docs/README.md).
