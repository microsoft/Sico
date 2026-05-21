# Sandbox Examples

These examples target the sandbox-client API surface protected by HMAC headers.

## Scripts

- `python3 -m examples.sandbox.apply_and_release`

## Environment

- `BASE_URL`: defaults to `http://localhost:8080`
- `SANDBOX_CLIENT_ID`: defaults to `test-client`
- `SANDBOX_CLIENT_SECRET_<CLIENT_ID>`: required; for the default client this is
  `SANDBOX_CLIENT_SECRET_TEST_CLIENT`
- `.env.example` already ships `SANDBOX_CLIENT_SECRET_TEST_CLIENT` so the default
  example wiring matches out of the box once you copy `.env.example` to `.env`
- Python examples auto-load the repo-root `.env`, so you do not need an extra
  `export SANDBOX_CLIENT_SECRET_TEST_CLIENT=...` step for the default flow
- `AGENT_INSTANCE_ID`: defaults to `2`, matching the seeded tester instance
- `SANDBOX_TYPE`: defaults to `emulator`

## Prerequisite

`apply_and_release` can only lease sandboxes that have already been assigned to
the target instance. With the defaults above, make sure at least one
`emulator` sandbox is assigned to agent instance `2` before you run the script.

If the script prints `No sandbox was allocated. Nothing to release.`, the HMAC
auth path worked, but no matching sandbox was available for that instance.

The script signs each request using the same `clientID|timestamp|nonce` payload
shape enforced by the backend middleware.
