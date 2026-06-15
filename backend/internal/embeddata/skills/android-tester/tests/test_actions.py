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

"""Unit tests for :mod:`android_tester.actions`.

Covers:

* :func:`compute_action_key` — stability, sort-independence, type variety.
* :func:`parse_operator_response` — every supported action verb, optional
  ``<think>`` / ``<conclusion>`` tags, whitespace tolerance, malformed input.
* :func:`parse_reflector_response` — section extraction, outcome classifier
  (SUCCESS / PARTIAL / FAILED), missing/empty sections.
"""

from __future__ import annotations

import pytest

from android_tester.actions import (
    ParsedAction,
    compute_action_key,
    parse_operator_response,
    parse_reflector_response,
)
from android_tester.models import AnswerFormatError

# ---------------------------------------------------------------------------
# compute_action_key
# ---------------------------------------------------------------------------


class TestComputeActionKey:
    def test_no_args(self) -> None:
        assert compute_action_key("PressBack", {}) == "PressBack"

    def test_single_arg(self) -> None:
        assert compute_action_key(
            "Click", {"point": (10, 20)}
        ) == "Click-point-(10, 20)"

    def test_sort_independent(self) -> None:
        # Same args dict, different insertion order -> same key.
        a = compute_action_key("Drag", {"start": (1, 2), "end": (3, 4)})
        b = compute_action_key("Drag", {"end": (3, 4), "start": (1, 2)})
        assert a == b

    def test_string_value(self) -> None:
        assert compute_action_key(
            "Type", {"content": "hello"}
        ) == "Type-content-hello"

    def test_mixed_value_types(self) -> None:
        key = compute_action_key(
            "Mixed",
            {"a": 1, "b": "two", "c": (3, 4)},
        )
        assert key == "Mixed-a-1-b-two-c-(3, 4)"


# ---------------------------------------------------------------------------
# parse_operator_response — happy paths per action
# ---------------------------------------------------------------------------


def _wrap(
    action: str,
    *,
    think: str | None = "next move",
    conclusion: str | None = "ok",
) -> str:
    parts: list[str] = []
    if think is not None:
        parts.append(f"<think>{think}</think>")
    parts.append(f"<action>{action}</action>")
    if conclusion is not None:
        parts.append(f"<conclusion>{conclusion}</conclusion>")
    return "".join(parts)


class TestParseOperatorActions:
    @pytest.mark.parametrize(
        ("verb", "args_text", "expected_name", "expected_args"),
        [
            (
                "Click",
                "box=(100,200)",
                "Click",
                {"point": (100, 200)},
            ),
            (
                "LongPress",
                "box=(50,60)",
                "LongPress",
                {"point": (50, 60)},
            ),
            (
                "Drag",
                "start=(1,2), end=(3,4)",
                "Drag",
                {"start": (1, 2), "end": (3, 4), "speed": "normal"},
            ),
            (
                "Drag",
                "start=(1,2), end=(3,4), speed='high'",
                "Drag",
                {"start": (1, 2), "end": (3, 4), "speed": "high"},
            ),
            (
                "Scroll",
                "start=(500,1500), end=(500,500)",
                "Scroll",
                {"start": (500, 1500), "end": (500, 500),
                 "speed": "normal"},
            ),
            (
                "Scroll",
                "start=(500,1500), end=(500,500), speed='high'",
                "Scroll",
                {"start": (500, 1500), "end": (500, 500),
                 "speed": "high"},
            ),
            (
                "Type",
                "content='hello world'",
                "Type",
                {"content": "hello world"},
            ),
            (
                "Launch",
                "app='Settings'",
                "Launch",
                {"app": "Settings"},
            ),
            (
                "OpenLink",
                "url='https://example.com/x?y=1&z=2'",
                "OpenLink",
                {"url": "https://example.com/x?y=1&z=2"},
            ),
            (
                "InstallApk",
                "source='/data/local/tmp/app.apk'",
                "InstallApk",
                {"source": "/data/local/tmp/app.apk"},
            ),
            (
                "InstallApk",
                "url='https://example.com/app.apk'",
                "InstallApk",
                {"source": "https://example.com/app.apk"},
            ),
            (
                "Uninstall",
                "app='com.example.app'",
                "Uninstall",
                {"app": "com.example.app"},
            ),
            (
                "ForceStop",
                "app='com.example.app'",
                "ForceStop",
                {"app": "com.example.app"},
            ),
            (
                "Finished",
                "content='all done'",
                "Finished",
                {"verdict": "pass", "content": "all done"},
            ),
            (
                "Finished",
                "verdict='bug', content='expected X, saw Y'",
                "Finished",
                {"verdict": "bug", "content": "expected X, saw Y"},
            ),
            (
                "Finished",
                "verdict='blocker', content='APK parse error'",
                "Finished",
                {"verdict": "blocker", "content": "APK parse error"},
            ),
            ("Wait", "", "Wait", {}),
            ("PressBack", "", "PressBack", {}),
            ("PressHome", "", "PressHome", {}),
            ("PressEnter", "", "PressEnter", {}),
            ("PressRecentApps", "", "PressRecentApps", {}),
            ("ClipboardGet", "", "ClipboardGet", {}),
            ("ClipboardPaste", "", "ClipboardPaste", {}),
            (
                "ClipboardPut",
                "content='hello from clipboard'",
                "ClipboardPut",
                {"content": "hello from clipboard"},
            ),
            ("ResourceList", "", "ResourceList", {}),
            ("FileList", "", "FileList", {"path": ""}),
            (
                "FileList",
                "path='Pictures'",
                "FileList",
                {"path": "Pictures"},
            ),
            (
                "FilePut",
                "source='cat.jpg', dest='Pictures'",
                "FilePut",
                {"source": "cat.jpg", "dest": "Pictures"},
            ),
            (
                "FileDelete",
                "path='Pictures/cat.jpg'",
                "FileDelete",
                {"path": "Pictures/cat.jpg"},
            ),
        ],
    )
    def test_each_supported_action(
        self,
        verb: str,
        args_text: str,
        expected_name: str,
        expected_args: dict[str, object],
    ) -> None:
        result = parse_operator_response(_wrap(f"{verb}({args_text})"))
        assert isinstance(result, ParsedAction)
        assert result.name == expected_name
        assert result.args == expected_args
        assert result.thought == "next move"
        assert result.conclusion == "ok"

    def test_negative_coordinates_allowed(self) -> None:
        result = parse_operator_response(_wrap("Click(box=(-10,-20))"))
        assert result.args == {"point": (-10, -20)}

    def test_extra_whitespace_in_xy(self) -> None:
        result = parse_operator_response(
            _wrap("Drag(start=( 1 ,  2 ), end=(3,4))")
        )
        assert result.args == {
            "start": (1, 2), "end": (3, 4), "speed": "normal",
        }

    def test_extra_whitespace_around_call(self) -> None:
        result = parse_operator_response(
            _wrap("   Click(box=(1,2))   ")
        )
        assert result.name == "Click"

    def test_type_double_quoted(self) -> None:
        result = parse_operator_response(
            _wrap('Type(content="double quoted")')
        )
        assert result.args == {"content": "double quoted"}

    def test_type_preserves_inner_single_quote(self) -> None:
        # Single quote inside double-quoted string survives.
        result = parse_operator_response(
            _wrap('Type(content="it\'s fine")')
        )
        assert result.args == {"content": "it's fine"}

    def test_type_empty_string(self) -> None:
        result = parse_operator_response(_wrap("Type(content='')"))
        assert result.args == {"content": ""}

    def test_install_apk_prefers_source_over_url(self) -> None:
        # When both `source` and `url` are present, `source` wins
        # because it is listed first in the tuple.
        result = parse_operator_response(
            _wrap(
                "InstallApk(source='/tmp/a.apk', "
                "url='https://example.com/b.apk')"
            )
        )
        assert result.args == {"source": "/tmp/a.apk"}

    def test_thought_optional(self) -> None:
        result = parse_operator_response(
            "<action>PressBack()</action><conclusion>back</conclusion>"
        )
        assert result.name == "PressBack"
        assert result.thought == ""
        assert result.conclusion == "back"

    def test_conclusion_optional(self) -> None:
        result = parse_operator_response(
            "<think>tap</think><action>Click(box=(1,2))</action>"
        )
        assert result.name == "Click"
        assert result.conclusion == ""

    def test_tags_case_insensitive(self) -> None:
        result = parse_operator_response(
            "<THINK>t</THINK><Action>PressHome()</Action>"
            "<Conclusion>c</Conclusion>"
        )
        assert result.name == "PressHome"
        assert result.thought == "t"
        assert result.conclusion == "c"

    def test_current_step_optional(self) -> None:
        result = parse_operator_response(
            "<think>t</think><action>PressHome()</action>"
            "<current_step>Open app settings</current_step>"
        )
        assert result.name == "PressHome"
        assert result.current_step == "Open app settings"

    def test_current_step_blank_normalized_to_none(self) -> None:
        result = parse_operator_response(
            "<action>PressHome()</action>"
            "<current_step>   </current_step>"
        )
        assert result.name == "PressHome"
        assert result.current_step is None

    def test_multiline_thought(self) -> None:
        result = parse_operator_response(
            "<think>line 1\nline 2\nline 3</think>"
            "<action>PressBack()</action>"
        )
        assert result.thought == "line 1\nline 2\nline 3"


# ---------------------------------------------------------------------------
# parse_operator_response — malformed input
# ---------------------------------------------------------------------------


class TestParseOperatorErrors:
    def test_missing_action_tag(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing <action>"):
            parse_operator_response("<think>t</think>")

    def test_malformed_action_call(self) -> None:
        with pytest.raises(AnswerFormatError, match="Invalid action format"):
            parse_operator_response(_wrap("not a function call"))

    def test_unsupported_action(self) -> None:
        with pytest.raises(AnswerFormatError, match="Unsupported action"):
            parse_operator_response(_wrap("Teleport(to='moon')"))

    def test_click_missing_box(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing box coordinates"):
            parse_operator_response(_wrap("Click()"))

    def test_drag_missing_end(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing end coordinates"):
            parse_operator_response(_wrap("Drag(start=(1,2))"))

    def test_drag_invalid_speed(self) -> None:
        with pytest.raises(AnswerFormatError, match="Invalid speed"):
            parse_operator_response(
                _wrap("Drag(start=(1,2), end=(3,4), speed='turbo')")
            )

    def test_type_missing_content(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing content string"):
            parse_operator_response(_wrap("Type()"))

    def test_launch_missing_app(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing app string"):
            parse_operator_response(_wrap("Launch()"))

    def test_install_apk_missing_source_and_url(self) -> None:
        with pytest.raises(
            AnswerFormatError, match="Missing one of source, url"
        ):
            parse_operator_response(_wrap("InstallApk()"))

    def test_uninstall_missing_app(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing app string"):
            parse_operator_response(_wrap("Uninstall()"))

    def test_force_stop_missing_app(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing app string"):
            parse_operator_response(_wrap("ForceStop()"))

    def test_open_link_missing_url(self) -> None:
        with pytest.raises(AnswerFormatError, match="Missing url string"):
            parse_operator_response(_wrap("OpenLink()"))

    def test_finished_missing_content(self) -> None:
        # Both `verdict` and `content` default; bare Finished() is allowed
        # and equivalent to a 'pass' with empty summary.
        result = parse_operator_response(_wrap("Finished()"))
        assert result.name == "Finished"
        assert result.args == {"verdict": "pass", "content": ""}

    def test_finished_verdict_only(self) -> None:
        result = parse_operator_response(_wrap("Finished(verdict='bug')"))
        assert result.args == {"verdict": "bug", "content": ""}

    def test_finished_verdict_case_insensitive(self) -> None:
        result = parse_operator_response(
            _wrap("Finished(verdict='BLOCKER', content='x')")
        )
        assert result.args == {"verdict": "blocker", "content": "x"}

    def test_finished_invalid_verdict_raises(self) -> None:
        with pytest.raises(AnswerFormatError, match="Invalid verdict"):
            parse_operator_response(
                _wrap("Finished(verdict='maybe', content='x')")
            )


# ---------------------------------------------------------------------------
# parse_reflector_response
# ---------------------------------------------------------------------------


def _reflector_response(
    *,
    what: str = "Button appeared.",
    outcome: str = "**SUCCESS** — clicked.",
    state: str = "Now on home screen.",
    goal: str = "Tap settings.",
) -> str:
    return (
        f"### What Happened\n{what}\n"
        f"### Outcome\n{outcome}\n"
        f"### Updated State\n{state}\n"
        f"### Next Step Goal\n{goal}\n"
    )


class TestParseReflectorResponse:
    def test_happy_path_success(self) -> None:
        result = parse_reflector_response(_reflector_response())
        what, outcome, state, goal, current_step = result
        assert what == "Button appeared."
        assert outcome == "SUCCESS"
        assert state == "Now on home screen."
        assert goal == "Tap settings."
        assert current_step is None

    @pytest.mark.parametrize(
        ("outcome_text", "expected"),
        [
            ("**SUCCESS** — done.", "SUCCESS"),
            ("success, nothing else", "SUCCESS"),
            ("**PARTIAL** progress", "PARTIAL"),
            ("partial change observed", "PARTIAL"),
            ("**FAILED** — no change", "FAILED"),
            ("failed", "FAILED"),
            ("inconclusive blob", "FAILED"),  # default fall-through
            ("", "FAILED"),
        ],
    )
    def test_outcome_classifier(
        self, outcome_text: str, expected: str
    ) -> None:
        # The classifier needs SOME outcome text to satisfy 'required';
        # use a sentinel placeholder when empty.
        text = outcome_text or "placeholder"
        response = _reflector_response(outcome=text)
        _, outcome, _, _, _ = parse_reflector_response(response)
        if outcome_text == "":
            # If text is non-empty (placeholder) it classifies as FAILED.
            assert outcome == "FAILED"
        else:
            assert outcome == expected

    def test_success_takes_precedence_over_partial(self) -> None:
        # _classify_outcome checks SUCCESS first.
        _, outcome, _, _, _ = parse_reflector_response(
            _reflector_response(outcome="SUCCESS but PARTIAL")
        )
        assert outcome == "SUCCESS"

    def test_case_insensitive_headers(self) -> None:
        response = (
            "### what happened\nA.\n"
            "### OUTCOME\nSUCCESS\n"
            "### Updated state\nB.\n"
            "### next step goal\nC.\n"
        )
        what, outcome, state, goal, _ = parse_reflector_response(response)
        assert what == "A."
        assert outcome == "SUCCESS"
        assert state == "B."
        assert goal == "C."

    def test_missing_what_happened(self) -> None:
        response = (
            "### Outcome\nSUCCESS\n"
            "### Updated State\nB.\n"
            "### Next Step Goal\nC.\n"
        )
        with pytest.raises(
            AnswerFormatError, match="Missing required section 'What Happened'"
        ):
            parse_reflector_response(response)

    def test_empty_next_step_goal_raises(self) -> None:
        # Goal header present but body empty -> "is empty" branch fires.
        response = (
            "### What Happened\nA.\n"
            "### Outcome\nSUCCESS\n"
            "### Updated State\nB.\n"
            "### Next Step Goal\n   \n"
        )
        with pytest.raises(
            AnswerFormatError,
            match="Required section 'Next Step Goal' is empty",
        ):
            parse_reflector_response(response)

    def test_empty_required_section_raises(self) -> None:
        response = (
            "### What Happened\n\n"
            "### Outcome\nSUCCESS\n"
            "### Updated State\nB.\n"
            "### Next Step Goal\nC.\n"
        )
        with pytest.raises(
            AnswerFormatError,
            match="Required section 'What Happened' is empty",
        ):
            parse_reflector_response(response)

    def test_multiline_section_body(self) -> None:
        response = (
            "### What Happened\n"
            "Line 1\nLine 2\nLine 3\n"
            "### Outcome\nSUCCESS\n"
            "### Updated State\nState.\n"
            "### Next Step Goal\nGoal.\n"
        )
        what, *_ = parse_reflector_response(response)
        assert what == "Line 1\nLine 2\nLine 3"

    def test_current_step_extracted_when_present(self) -> None:
        response = (
            "### What Happened\nA.\n"
            "### Outcome\nSUCCESS\n"
            "### Updated State\nB.\n"
            "### Next Step Goal\nC.\n"
            "### Current Step\nOpen the menu\n"
        )
        _, _, _, goal, current_step = parse_reflector_response(response)
        assert goal == "C."
        assert current_step == "Open the menu"

    def test_current_step_absent_normalized_to_none(self) -> None:
        _, _, _, _, current_step = parse_reflector_response(
            _reflector_response()
        )
        assert current_step is None
