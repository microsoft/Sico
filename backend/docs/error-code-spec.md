# Backend Error Code Specification (v1)

This document defines the **business error code** (`code`) conventions for `dwp-backend`, used by HTTP/GRPC transports.

## Goals

- **Stable**: once published, codes must not change arbitrarily.
- **Traceable**: a code should quickly indicate the owning module and the error kind.
- **Scalable**: modules own non-overlapping ranges to avoid collisions.
- **Transport-friendly**: return stable `code` + user-facing `msg` for business errors; HTTP status is **not** used to represent business semantics.

## Fields

- `code`: business error code (`int32`), **not** HTTP status.
- `msg`: user-facing message (must not leak SQL, stack traces, internal details).
- HTTP status policy (HTTP transport):
  - **Business errors**: always return **HTTP 200**; clients must check non-zero `code`.
  - **Internal/unexpected errors**: return **HTTP 500** with `CommonInternalError`.

## Code Format

Recommended format: `1MMEEE`

- `1`: fixed prefix (backend business errors)
- `MM`: module/domain id (2 digits)
- `EEE`: error sequence within the module (3 digits)

Example:
- `100004`: Common (`00`) not found.

## Module Allocations (v1)

Each module owns codes in `[Base, Base+999]`.

- `100000-100999`: Common / cross-cutting
- `101000-101999`: RBAC
- `102000-102999`: Agent
- `103000-103999`: Conversation
- `104000-104999`: Knowledge
- `106000-106999`: Project
- `110000-110999`: LLM

When adding a new domain module, allocate a new `MM` and never recycle ranges.

## Common Codes (100000-100999)

- `100000` `CommonInternalError`: internal server error (HTTP 500)
- `100001` `CommonInvalidParam`: invalid argument
- `100002` `CommonUnauthorized`: unauthenticated
- `100003` `CommonForbidden`: permission denied
- `100004` `CommonNotFound`: resource not found
- `100005` `CommonConflict`: conflict/duplicate
- `100006` `CommonUnavailable`: dependency unavailable

## Implementation Guidelines

- **NotFound is common**: all "not found" cases must use `100004` `CommonNotFound`; do not define or return module-specific not-found codes.

- **Store layer stays raw** (DB errors, GORM errors, etc.). Biz wraps to typed errors with `code` + `msg`.
- Transport returns **HTTP 200 for business errors**; only unexpected/internal errors return HTTP 500.
- Avoid string matching; use `errors.As/Is`.
- Keep `msg` stable and user-facing; log internal causes separately.

Reference implementations:
- `backend/internal/shared/errcode`
- `backend/internal/shared/apperr`
