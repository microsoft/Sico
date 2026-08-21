"""Apply for a sandbox lease, then release it."""

from __future__ import annotations

import os

from examples._shared.http import env_int, json_request, print_json
from examples._shared.sandbox_auth import signed_headers


def main() -> None:
    client_id = os.environ.get("SANDBOX_CLIENT_ID", "test-client")
    agent_instance_id = env_int("AGENT_INSTANCE_ID", 2)
    sandbox_type = os.environ.get("SANDBOX_TYPE", "emulator")

    apply_headers = signed_headers(client_id, instance_id=agent_instance_id)
    apply_response = json_request(
        "/api/sico/sandbox/apply",
        method="POST",
        payload={"type": sandbox_type},
        headers=apply_headers,
    )

    print("Apply response:")
    print_json(apply_response)

    data = apply_response.get("data") or {}
    sandbox_id = data.get("sandbox_id")
    if not sandbox_id:
        print("\nNo sandbox was allocated. Nothing to release.")
        return

    release_headers = signed_headers(client_id, instance_id=agent_instance_id)
    release_response = json_request(
        "/api/sico/sandbox/release",
        method="POST",
        payload={"sandbox_id": sandbox_id},
        headers=release_headers,
    )

    print("\nRelease response:")
    print_json(release_response)


if __name__ == "__main__":
    main()
