# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches a stable 1.0 release. While on `0.x`, breaking changes may
land in minor versions and will be called out in the `Changed` or `Removed`
sections below.

<!--
Guidelines for editors:

- Add user-facing changes under the `## [Unreleased]` section.
- Group entries by type: Added / Changed / Deprecated / Removed / Fixed / Security.
- Prefer one short bullet per change; link the PR or issue at the end of the line.
- Internal refactors, CI tweaks, and docs-only changes usually do **not** need
  an entry unless they change observable behavior.
- When cutting a release, rename `[Unreleased]` to `[x.y.z] - YYYY-MM-DD` and
  add the compare link at the bottom.
-->

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security


## [0.3.0] - 2026-07-21

_Highlights: multi-session chat, project deliverables, context management, and a
domain-scoped RBAC system._

### Added

- **Multi-session chat:** session management and transcript handling so a
  conversation can span multiple chat sessions, with single-session history
  loading that is context-aware (#63).
- **Conversation re-connect:** resume interrupted conversations with unit-test
  coverage for the reconnect path.
- **Project deliverables:** publish files produced during chat sessions as
  project deliverables. Adds the `t_project_deliverable` store, deliverable
  proto/API, and richer project detail/query responses (#69).
- **RBAC system (domain-scoped):** introduce an organization entity and switch
  Casbin from flat `(sub, obj, act)` to domain-scoped `(sub, dom, obj, act)`
  policies. Adds the `t_organization` table, `role_code` + scope columns on
  user roles, and seeded `platform_admin` / `org_admin` / `project_admin` /
  `project_member` role templates. Agent-instance CRUD is now guarded by the
  `dw.manage` permission.
- **Experience improvements:** playbook management, per-turn learned
  experience tuning, and display fixes (restored from #59).

### Changed

- **Context management:** reintegrate tool-context compaction to keep long
  conversations within the model's context budget.
- Sync chat construction and plan/message handling with upstream.

### Removed

- Removed the `test-cases-rewrite` skill and its backend wiring.

### Fixed

- Core: repair cancelled tool-call history.
- Frontend: read agent avatar from `agentIconUrl`, pass `conversationId` to
  `/conversation/plan` and `plan/cancel`, redirect bare `/` to `/digital-worker`
  with deliverable `fileUri` fallback, treat roles as scoped objects with an
  optional project `iconUrl`, and commit vendored config base files (#90, #93,
  #96, #97, #98).
- Restore the vendored frontend build-from-source pipeline (#83).


## [0.2.0] - 2026-06-11

### Added

- **Android Tester skill enhancements:** precondition record-replay system, clipboard tools, file tools, swipe speed levels, force-stop app action, ternary status codes, batch execution trace grouping, structured recorder data, and multi-turn conversation history for operator.
- **Skill resolver API:** request explicit skill versions from core, improved retry diagnostics, and skill version detail endpoints.
- **Task runtime improvements:** batch-level liveness with orphan pod defense, bucket batch concurrency by sandbox type, state machine and event bus architecture.
- **Chat routing fast path:** intent-check model for direct responses on simple queries, short-cutting the full planning pipeline.
- **Conversation re-connect:** allow resuming interrupted conversations.
- **Adapter tool:** workbook resolver adapter with general adapter support for delegating tasks.
- **Documentation:** technical report (survey paper), updated architecture diagrams, quickstart with Android emulator instructions, DW-type creation guide, roadmap revision, and Digital Tester troubleshooting guide.

### Changed

- Refactored core task runtime: split manager, added dispatch union, prepared batch, view renderers, narrowed `submit_prepared` surface with `TurnContext`, and removed credentials/redaction code.
- Plan structure now uses sub tool calls and message updates for delegated tasks.
- Updated system prompts and extraction prompts.

### Fixed

- Sandbox pod stuck in `ContainerCreating` when mounts share one PVC.
- Kafka OOM resolved via resource limits.
- Android Tester: device offline detection, connection error retries, atomic file writes, empty text input handling, malformed script handling, precondition step reporting format.
- Backend: auth context key fix, user retrieval from context, migration fixes.
- Skill: return full download URL, historical skill version details.

### Security

- Bumped vulnerable dependencies.
- Tightened Content Security Policy (CSP) in frontend.

<!--
Example release entry:

## [0.1.0] - 2026-04-22

### Added
- Initial public release of the backend, core, and frontend services.

[Unreleased]: https://github.com/OWNER/REPO/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OWNER/REPO/releases/tag/v0.1.0
-->
