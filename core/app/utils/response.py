def success_response(obj):
    obj.code = 0
    obj.msg = "success"
    return obj

def error_response(obj, code: int, msg: str):
    obj.code = code
    obj.msg = msg
    return obj


def failed_response(obj, msg: str = "failed", code: int = 1):
    """Convenience wrapper for non-successful responses."""
    return error_response(obj, code, msg)
