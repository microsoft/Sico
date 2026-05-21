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
