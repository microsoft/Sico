import json
import re
import time
from typing import Any


def serialize_dict(data: dict[str, Any]) -> dict[str, str]:
    r = {}
    for k, v in data.items():
        r[k] = json.dumps(v)
    return r

def deserialize_dict(data: dict[str, str]) -> dict[str, Any]:
    r = {}
    for k, v in data.items():
        try:
            r[k] = json.loads(v)
        except json.JSONDecodeError:
            r[k] = v
    return r

def timestamp() -> int:
    """Get current timestamp in milliseconds."""
    return int(time.time() * 1000)

def apply_string_template(template: str, params: dict[str, Any]) -> str:
    '''
    For a template with {{key}} placeholders, replace them with corresponding values from params.
    For params of (int, float, string, bool), use a str(value) to replace.
    For params of (dict, list), use json.dumps(value) to replace.
    '''
    regular_expr = r'\{\{\s*([\w_\.\[\]]+)\s*\}\}'
    def replace_match(match: re.Match) -> str:
        key = match.group(1)
        if key not in params:
            raise ValueError(f"Key '{key}' not found in parameters for template substitution.")
        value = params[key]
        if isinstance(value, dict | list):
            return json.dumps(value)
        return str(value)
    return re.sub(regular_expr, replace_match, template)
