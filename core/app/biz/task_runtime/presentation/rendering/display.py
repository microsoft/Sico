from __future__ import annotations

from ...domain.models import ErrorClass


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
