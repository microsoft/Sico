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

"""Delta operations produced by the Curator."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal, cast

OperationType = Literal["ADD", "UPDATE", "TAG", "REMOVE"]


@dataclass
class DeltaOperation:
    """Single mutation to apply to the playbook."""

    type: OperationType
    section: str
    content: str | None = None
    bullet_id: str | None = None
    metadata: dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_json(cls, payload: dict[str, object]) -> DeltaOperation:
        # Filter metadata for TAG operations to only include valid tags
        metadata_raw = payload.get("metadata") or {}
        metadata: dict[str, Any] = (
            cast(dict[str, Any], metadata_raw) if isinstance(metadata_raw, dict) else {}
        )

        if str(payload["type"]).upper() == "TAG":
            # Only include valid tag names for TAG operations
            valid_tags = {"helpful", "harmful", "neutral"}
            metadata = {k: v for k, v in metadata.items() if str(k) in valid_tags}

        op_type = str(payload["type"]).upper()
        if op_type not in ("ADD", "UPDATE", "TAG", "REMOVE"):
            raise ValueError(f"Invalid operation type: {op_type}")

        return cls(
            type=cast(OperationType, op_type),
            section=str(payload.get("section", "")),
            content=(
                str(payload["content"]) if payload.get("content") is not None else None
            ),
            bullet_id=(
                str(payload["bullet_id"])
                if payload.get("bullet_id") is not None
                else None
            ),
            metadata={str(k): int(v) for k, v in metadata.items()},
        )

    def to_json(self) -> dict[str, object]:
        data: dict[str, object] = {"type": self.type, "section": self.section}
        if self.content is not None:
            data["content"] = self.content
        if self.bullet_id is not None:
            data["bullet_id"] = self.bullet_id
        if self.metadata:
            data["metadata"] = self.metadata
        return data


@dataclass
class DeltaBatch:
    """Bundle of curator reasoning and operations."""

    reasoning: str
    operations: list[DeltaOperation] = field(default_factory=list)

    @classmethod
    def from_json(cls, payload: dict[str, object]) -> DeltaBatch:
        ops_payload = payload.get("operations")
        operations = []
        if isinstance(ops_payload, Iterable):
            for item in ops_payload:
                if isinstance(item, dict):
                    operations.append(DeltaOperation.from_json(item))
        return cls(reasoning=str(payload.get("reasoning", "")), operations=operations)

    def to_json(self) -> dict[str, object]:
        return {
            "reasoning": self.reasoning,
            "operations": [op.to_json() for op in self.operations],
        }
