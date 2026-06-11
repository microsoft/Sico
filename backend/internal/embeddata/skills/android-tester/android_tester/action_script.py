"""Action script: data model and JSON serialization."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from android_tester.utils import write_file_atomically


@dataclass(slots=True)
class ActionStep:
    """One recorded step: the action executed and its a11y context."""

    elapsed_s: float
    action_name: str
    action_args: dict[str, Any]
    conclusion: str
    target_node: dict[str, Any] | None = None
    screenshot_uri: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "elapsed_s": round(self.elapsed_s, 2),
            "action_name": self.action_name,
            "action_args": {
                k: list(v) if isinstance(v, tuple) else v
                for k, v in self.action_args.items()
            },
            "conclusion": self.conclusion,
            "screenshot": self.screenshot_uri,
        }
        if self.target_node is not None:
            d["target_node"] = self.target_node
        return d


def _parse_action_args(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert JSON arrays back to tuples (coordinates)."""
    return {
        k: tuple(v) if isinstance(v, list) else v
        for k, v in raw.items()
    }


@dataclass
class ActionScript:
    """A recorded sequence of actions with optional a11y node snapshots."""

    instruction: str
    status: str = ""
    elapsed_s: float = 0.0
    steps: list[ActionStep] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "instruction": self.instruction,
            "status": self.status,
            "elapsed_s": round(self.elapsed_s, 2),
            "steps": [s.to_dict() for s in self.steps],
        }

    def save(self, path: Path) -> None:
        # Atomic write so concurrent android-tester processes sharing this
        # path can't observe a torn file. Last writer wins.
        write_file_atomically(
            path,
            json.dumps(self.to_dict(), indent=2, ensure_ascii=False),
        )

    @classmethod
    def load(cls, path: Path) -> ActionScript:
        raw = json.loads(path.read_text(encoding="utf-8"))
        steps = [
            ActionStep(
                elapsed_s=s.get("elapsed_s", 0.0),
                action_name=s["action_name"],
                action_args=_parse_action_args(s["action_args"]),
                conclusion=s.get("conclusion", ""),
                target_node=s.get("target_node"),
                screenshot_uri=s.get("screenshot", ""),
            )
            for s in raw.get("steps", [])
        ]
        return cls(
            instruction=raw.get("instruction", ""),
            status=raw.get("status", ""),
            elapsed_s=raw.get("elapsed_s", 0.0),
            steps=steps,
        )
