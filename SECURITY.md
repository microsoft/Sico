# Security Policy

We take the security of Sico seriously. Thank you for helping keep the
project and its users safe.

## Supported versions

Sico is pre-1.0 and under active development. Security fixes are applied to
the `main` branch. When a stable release line exists, this section will be
updated to list supported versions.

## Reporting a vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

For Microsoft-owned projects, the preferred reporting channel is the
**Microsoft Security Response Center (MSRC)**: report at
[https://msrc.microsoft.com/create-report](https://msrc.microsoft.com/create-report),
or email [secure@microsoft.com](mailto:secure@microsoft.com). MSRC coordinates
disclosure across Microsoft products and is the canonical channel for issues
with potential cross-product impact.

As an alternative, you can also report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof-of-concept.
- Any suggested mitigations.

We will acknowledge your report, investigate, and keep you informed of
progress. We aim to provide an initial response within a few business days.

## Disclosure policy

We practice **coordinated disclosure**. After a fix is available, we will
publish a security advisory crediting the reporter (unless anonymity is
requested).

## Scope

The following are **in scope** for security reports:

- Authentication and authorization flaws (JWT, RBAC, HMAC sandbox auth).
- Injection vulnerabilities (SQL, command, prompt injection with real impact).
- Sensitive-data exposure in logs, API responses, or storage.
- Remote code execution or container escape in sandbox components.
- Denial-of-service with a low-cost trigger.

The following are **out of scope**:

- Vulnerabilities in third-party services Sico integrates with (report those
  to the upstream maintainers).
- Reports that require physical access to a developer machine.
- Missing security headers with no demonstrated impact.
- Findings from automated scanners without a working proof-of-concept.

## Hardening guidance for operators

If you deploy Sico, please also follow standard operator hygiene:

- Rotate all secrets from `.env.example` before exposing the service.
- Use TLS in front of Nginx.
- Restrict network access to MySQL, Redis, SeaweedFS, and Kafka to the
  internal network.
- Keep container images and OS packages up to date.
- Review [docs/technical_report.md](docs/technical_report.md) and
  [docs/quickstart.md](docs/quickstart.md) before going to production.
