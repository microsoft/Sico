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

from app.utils.sanitize import (
    sanitize_dns_label,
    sanitize_mem0_entity_id,
    sanitize_tool_name,
    sanitize_user_id,
)


def test_sanitize_mem0_entity_id_removes_whitespace():
    assert sanitize_mem0_entity_id(" Alice Smith ") == "Alice_Smith"
    assert sanitize_mem0_entity_id("alice@example.com") == "alice@example.com"
    assert sanitize_mem0_entity_id(" \t ") is None


def test_sanitize_user_id_uses_legacy_filesystem_behavior():
    assert sanitize_user_id("User Name@example.com") == "User Name_at_example.com"
    assert sanitize_user_id("user:name@example.com") == "user_name_at_example.com"


def test_sanitize_dns_label_matches_kubernetes_label_rules():
    assert sanitize_dns_label("Alice_Smith@example.com", max_len=20) == "alice-smith-at-examp"
    assert sanitize_dns_label("!!!") == "u"


def test_sanitize_tool_name_collapses_invalid_characters():
    assert sanitize_tool_name(" My Tool!! ") == "My_Tool"
    assert sanitize_tool_name("!!!", default="fallback") == "fallback"
