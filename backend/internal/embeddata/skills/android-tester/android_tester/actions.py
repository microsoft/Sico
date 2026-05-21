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

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache

from android_tester.models import AnswerFormatError

_ACTION_CALL_RE = re.compile(
    r"(?P<fn>\w+)\s*\((?P<args>.*)\)\s*$", flags=re.DOTALL
)


@cache
def _get_tag_pattern(tag: str) -> re.Pattern[str]:
    return re.compile(
        rf"<{tag}>\s*(?P<content>.*?)\s*</{tag}>",
        flags=re.IGNORECASE | re.DOTALL,
    )


@cache
def _get_section_pattern(start: str,
                         end: str | None = None,
                         ) -> re.Pattern[str]:
    tail = (
        r"(?P<body>.*)"
        if end is None
        else rf"(?P<body>.*?)###\s*{re.escape(end)}"
    )
    return re.compile(
        rf"###\s*{re.escape(start)}\s*\n{tail}",
        flags=re.DOTALL | re.IGNORECASE,
    )


@cache
def _get_xy_pattern(field: str) -> re.Pattern[str]:
    return re.compile(
        rf"{field}\s*=\s*\(\s*(?P<x>-?\d+)\s*,\s*(?P<y>-?\d+)\s*\)"
    )


@cache
def _get_str_arg_pattern(field: str) -> re.Pattern[str]:
    return re.compile(
        rf"{field}\s*=\s*(?P<q>['\"])(?P<value>.*?)(?P=q)",
        flags=re.DOTALL,
    )


@dataclass(slots=True)
class ParsedAction:
    name: str
    args: dict[str, object]
    thought: str
    conclusion: str


def parse_operator_response(response: str) -> ParsedAction:
    thought = _extract_tag(response, "think")
    action = _extract_tag(response, "action", required=True)
    conclusion = _extract_tag(response, "conclusion")
    name, args = _parse_action_call(action)
    return ParsedAction(name=name, 
                        args=args, 
                        thought=thought, 
                        conclusion=conclusion)


def parse_reflector_response(response: str) -> tuple[str, str, str, str]:
    what_happened = _extract_section(response, 
                                     start="What Happened", 
                                     end="Outcome",
                                     required=True)
    outcome = _extract_section(response, 
                               start="Outcome", 
                               end="Updated State",
                               required=True)
    updated_state = _extract_section(response, 
                                     start="Updated State", 
                                     end="Next Step Goal",
                                     required=True)
    next_step_goal = _extract_section(response,
                                      start="Next Step Goal",
                                      required=True)
    outcome_label = _classify_outcome(outcome)
    return what_happened, outcome_label, updated_state, next_step_goal


def _extract_tag(text: str, tag: str, required: bool = False) -> str:
    match = _get_tag_pattern(tag).search(text)
    if required and not match:
        raise AnswerFormatError(f"Missing <{tag}> tag in response")
    return match.group("content").strip() if match else ""


def _parse_action_call(raw: str) -> tuple[str, dict[str, object]]:
    call = raw.strip()
    match = _ACTION_CALL_RE.match(call)
    if not match:
        raise AnswerFormatError(f"Invalid action format: {raw!r}")
    fn = match.group("fn")
    args = match.group("args")

    match fn:
        case "Click" | "LongPress":
            return fn, {
                "point": _extract_xy(args, "box"),
            }
        case "Drag" | "Scroll":
            return fn, {
                "start": _extract_xy(args, "start"),
                "end": _extract_xy(args, "end"),
            }
        case "Type":
            return fn, {
                "content": _extract_str_arg(args, "content"),
            }
        case "Launch":
            return fn, {
                "app": _extract_str_arg(args, "app"),
            }
        case "Finished":
            return fn, {
                "content": _extract_str_arg(args, "content"),
            }
        case ("Wait" | "PressBack" | "PressHome" | "PressEnter" 
              | "PressRecentApps"):
            return fn, {}
        case _:
            raise AnswerFormatError(
                f"Unsupported action: {fn!r}"
            )


def _extract_xy(args: str, field: str) -> tuple[int, int]:
    match = _get_xy_pattern(field).search(args)
    if not match:
        raise AnswerFormatError(
            f"Missing {field} coordinates in: {args!r}"
        )
    return int(match.group("x")), int(match.group("y"))


def _extract_str_arg(args: str, field: str) -> str:
    match = _get_str_arg_pattern(field).search(args)
    if not match:
        raise AnswerFormatError(
            f"Missing {field} string in: {args!r}"
        )
    return match.group("value")


def _extract_section(
    text: str,
    start: str,
    end: str | None = None,
    *,
    required: bool = False,
) -> str:
    match = _get_section_pattern(start, end).search(text)
    if match is None:
        if required:
            raise AnswerFormatError(
                f"Missing required section {start!r} in response"
            )
        return ""
    body = match.group("body").strip()
    if required and not body:
        raise AnswerFormatError(
            f"Required section {start!r} is empty"
        )
    return body


def _classify_outcome(outcome_text: str) -> str:
    upper = outcome_text.upper()
    if "SUCCESS" in upper:
        return "SUCCESS"
    if "PARTIAL" in upper:
        return "PARTIAL"
    return "FAILED"
