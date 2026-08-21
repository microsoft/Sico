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
