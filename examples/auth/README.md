# Auth Examples

Use this group to bootstrap a local user and obtain a JWT for the rest of the
 examples directory.

## Scripts

- `python3 -m examples.auth.register_and_login`

## Environment

- `BASE_URL`: defaults to `http://localhost:8080`
- `SICO_EXAMPLE_EMAIL`: optional; if omitted, the script generates a unique local email
- `SICO_EXAMPLE_PASSWORD`: optional; defaults to `sico-demo-123`

The script prints `export TOKEN=...` so follow-up examples can reuse the same
session.