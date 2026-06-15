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

"""Neutral progress event payloads used by the runtime core.

These value objects let the core publish structured progress cards without
importing chat plan schema classes. Presentation-layer adapters map them into
concrete `ToolDeliverable` instances for `PlanEditor`.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import SandboxLeaseRef


@dataclass(frozen=True)
class AcquiredSandboxDeliverableSpec:
    sandbox_id: str
    sandbox_type: str
    endpoint: str
    provider_base_url: str
    device_id: str
    display_name: str
    vnc_url: str


@dataclass(frozen=True)
class DeliverableSpec:
    kind: str
    acquired_sandbox_card: AcquiredSandboxDeliverableSpec | None = None

    @classmethod
    def acquired_sandbox(
        cls,
        *,
        sandbox_id: str,
        sandbox_type: str,
        endpoint: str,
        provider_base_url: str,
        device_id: str,
        display_name: str,
        vnc_url: str,
    ) -> DeliverableSpec:
        return cls(
            kind="acquired_sandbox",
            acquired_sandbox_card=AcquiredSandboxDeliverableSpec(
                sandbox_id=sandbox_id,
                sandbox_type=sandbox_type,
                endpoint=endpoint,
                provider_base_url=provider_base_url,
                device_id=device_id,
                display_name=display_name,
                vnc_url=vnc_url,
            ),
        )


def acquired_sandbox_replace_key(deliverable: DeliverableSpec) -> str | None:
    if deliverable.kind != "acquired_sandbox" or deliverable.acquired_sandbox_card is None:
        return None
    return deliverable.acquired_sandbox_card.sandbox_id or None


def sandbox_identity_label(sandbox: SandboxLeaseRef) -> str:
    if sandbox.device_id:
        return f"device_id={sandbox.device_id}"
    if sandbox.sandbox_id:
        return f"sandbox_id={sandbox.sandbox_id}"
    return ""


def sandbox_display_name(sandbox: SandboxLeaseRef) -> str:
    identity = sandbox_identity_label(sandbox)
    return f"{sandbox.type} sandbox ({identity})" if identity else f"{sandbox.type} sandbox"
