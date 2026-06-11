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

from ...models import ErrorClass


_ERROR_CLASS_LABELS: dict[ErrorClass, str] = {
    ErrorClass.TRANSIENT: "Retryable temporary failure",
    ErrorClass.SANDBOX_UNHEALTHY: "Sandbox health issue",
    ErrorClass.SANDBOX_NO_CAPACITY: "No sandbox capacity",
    ErrorClass.TIMEOUT: "Execution timed out",
    ErrorClass.USER_INPUT: "Invalid or missing user input",
    ErrorClass.SKILL_RUNTIME: "Skill runtime failure",
    ErrorClass.POLICY_DENY: "Denied by policy",
    ErrorClass.INTERNAL: "Internal error",
    ErrorClass.CANCELLED: "Cancelled",
}


def error_class_label(error_class: ErrorClass | None) -> str:
    if error_class is None:
        return ""
    return _ERROR_CLASS_LABELS.get(error_class, error_class.value.replace("_", " "))


def failure_reason_label(error_class: ErrorClass | None, error_message: str = "") -> str:
    label = error_class_label(error_class)
    message = " ".join((error_message or "").split())
    raw_class = error_class.value if error_class is not None else ""
    if not message or message.lower() == raw_class.lower() or message == label:
        return label or message
    if label:
        return f"{label} ({message})"
    return message
