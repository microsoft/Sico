# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

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
