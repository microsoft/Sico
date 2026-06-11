"""
Shared HTML rendering utilities for breakdown and requirement reports.
Provides CSS, header/footer templates, and reusable HTML fragment builders.
"""
from pathlib import Path

from .i18n import S

# ═══════════════════════════════════════════════════════════════
#  CSS — union of breakdown + requirement styles
# ═══════════════════════════════════════════════════════════════

CSS = """\
:root { --bg:#f8f9fa; --card:#fff; --border:#dee2e6; --text:#212529; --text2:#6c757d; --accent:#0d6efd; --green:#198754; --green-bg:#d1e7dd; --red:#dc3545; --red-bg:#f8d7da; --orange:#fd7e14; --orange-bg:#fff3cd; --gray:#adb5bd; --blue-bg:#cfe2ff; --blue:#084298; --purple:#6f42c1; --purple-bg:#e8daef; --cyan:#0dcaf0; --cyan-bg:#cff4fc; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; padding:24px; }
.container { max-width:1500px; margin:0 auto; }
h1 { font-size:1.75rem; margin-bottom:8px; color:var(--accent); }
.subtitle { color:var(--text2); margin-bottom:24px; font-size:0.95rem; }
h2 { font-size:1.35rem; margin:28px 0 14px; padding-bottom:8px; border-bottom:2px solid var(--accent); display:inline-block; }
h3 { font-size:1.05rem; margin-bottom:10px; }
.summary-bar { display:flex; gap:14px; flex-wrap:wrap; margin:16px 0 24px; }
.summary-card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px 20px; text-align:center; flex:1; min-width:130px; box-shadow:0 1px 3px rgba(0,0,0,0.06); }
.summary-card .label { font-size:0.8rem; color:var(--text2); margin-bottom:4px; }
.summary-card .value { font-size:1.8rem; font-weight:700; }
.summary-card .sub { font-size:0.78rem; color:var(--text2); margin-top:2px; }
.summary-card.total .value { color:var(--accent); }
.summary-card.green .value { color:var(--green); }
.summary-card.orange .value { color:#856404; }
.summary-card.red .value { color:var(--red); }
.summary-card.blue .value { color:var(--blue); }
.summary-card.with-reqs .value { color:var(--green); }
.summary-card.cat-apps .value { color:#084298; }
.summary-card.cat-accts .value { color:#6f42c1; }
.summary-card.cat-files .value { color:#198754; }
.summary-card.cat-urls .value { color:#087990; }
.summary-card.cat-env .value { color:#856404; }
.summary-card.cat-hw .value { color:#dc3545; }
.summary-card.cat-preconf .value { color:#495057; }
.overview-table, .req-table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:8px; overflow:hidden; margin:14px 0 24px; }
.overview-table th, .req-table th { background:#343a40; color:white; padding:10px 14px; text-align:left; font-size:0.82rem; }
.overview-table td, .req-table td { padding:8px 14px; border-bottom:1px solid #f1f3f5; font-size:0.83rem; vertical-align:middle; }
.overview-table tr:hover, .req-table tr:hover { background:#f8f9fa; }
.group-header { padding:10px 14px; font-weight:700; font-size:0.88rem; }
.group-header.record { background:#e7f1ff; color:var(--blue); }
.group-header.quick_win { background:#d1e7dd; color:var(--green); }
.group-header.review { background:#fff3cd; color:#856404; }
.group-header.skip { background:#f8d7da; color:var(--red); }
.badge { display:inline-block; padding:2px 10px; border-radius:12px; font-size:0.72rem; font-weight:600; margin:1px 2px; white-space:nowrap; }
.badge.green { background:var(--green-bg); color:var(--green); }
.badge.orange { background:var(--orange-bg); color:#856404; }
.badge.red { background:var(--red-bg); color:var(--red); }
.badge.blue { background:var(--blue-bg); color:var(--blue); }
.badge.gray { background:#e9ecef; color:#495057; }
.artifact { display:inline-block; padding:2px 6px; border-radius:3px; font-size:0.7rem; font-weight:600; margin:1px 2px; }
.artifact.yes { background:#d1e7dd; color:var(--green); }
.artifact.no { background:#f8d7da; color:var(--red); }
.feat-section { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:15px 20px; margin:15px 0; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
.case-count { display:inline-block; background:var(--accent); color:white; border-radius:12px; padding:2px 10px; font-size:12px; margin-left:8px; }
.infra-box { border-radius:6px; padding:12px 16px; margin:8px 0; font-size:0.85rem; }
.infra-box.complete { background:#d1e7dd; border:1px solid var(--green); }
.infra-box.partial { background:#fff3cd; border:1px solid var(--orange); }
.infra-box.none { background:#e9ecef; border:1px solid var(--gray); }
.infra-box h4 { font-size:0.9rem; margin:0 0 8px; }
.infra-box ul { margin:4px 0 4px 18px; padding:0; }
.infra-box li { margin:2px 0; }
.sandbox-box { background:#f8d7da; border:1px solid var(--red); border-radius:6px; padding:12px 16px; margin:8px 0; font-size:0.85rem; }
.sandbox-box h4 { color:var(--red); font-size:0.9rem; margin:0 0 8px; }
.rec-box { border-radius:6px; padding:12px 16px; margin:8px 0; font-size:0.85rem; }
.rec-box.skip { background:#f8d7da; border:1px solid var(--red); }
.rec-box.record { background:var(--blue-bg); border:1px solid #6ea8fe; }
.rec-box.quick { background:#d1e7dd; border:1px solid var(--green); }
.rec-box.review { background:#fff3cd; border:1px solid var(--orange); }
.rec-box h4 { font-size:0.9rem; margin:0 0 6px; }
.case-table { width:100%; border-collapse:collapse; font-size:0.83rem; margin:8px 0; }
.case-table th { background:#f1f3f5; padding:7px 10px; text-align:left; font-size:0.78rem; color:var(--text2); }
.case-table td { padding:6px 10px; border-bottom:1px solid #f1f3f5; vertical-align:top; }
.case-id { font-weight:600; color:var(--accent); white-space:nowrap; font-family:monospace; }
.action-section { margin:20px 0; }
.action-list { list-style:none; padding:0; }
.action-list li { padding:8px 14px; margin:4px 0; border-radius:6px; font-size:0.85rem; }
.action-list li.record { background:var(--blue-bg); border-left:4px solid var(--accent); }
.action-list li.quick { background:#d1e7dd; border-left:4px solid var(--green); }
.action-list li.skip { background:#f8d7da; border-left:4px solid var(--red); }
.action-list li.review { background:#fff3cd; border-left:4px solid var(--orange); }
.risk-table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:8px; overflow:hidden; margin:14px 0; }
.risk-table th { background:#343a40; color:white; padding:10px 14px; text-align:left; font-size:0.82rem; }
.risk-table td { padding:8px 14px; border-bottom:1px solid #f1f3f5; font-size:0.83rem; vertical-align:middle; }
.group-divider { margin:28px 0 10px; padding:10px 16px; border-radius:8px; font-size:1.1rem; font-weight:700; }
.group-divider.record { background:#e7f1ff; color:var(--blue); border-left:5px solid var(--accent); }
.group-divider.quick_win { background:#d1e7dd; color:var(--green); border-left:5px solid var(--green); }
.group-divider.review { background:#fff3cd; color:#856404; border-left:5px solid var(--orange); }
.group-divider.skip { background:#f8d7da; color:var(--red); border-left:5px solid var(--red); }
.collection-box { background:#e8f5e9; border:1px solid #4caf50; border-radius:6px; padding:12px 16px; margin:8px 0 12px 0; font-size:0.85rem; }
.collection-box h4 { color:#2e7d32; font-size:0.9rem; margin:0 0 8px; }
.collection-box ul { margin:4px 0 8px 18px; padding:0; }
.collection-box li { margin:2px 0; }
.collection-box .sub-title { font-weight:600; color:#1b5e20; margin-top:8px; display:block; }
.vpn-box { background:#e0e7ff; border:1px solid #6366f1; border-radius:6px; padding:12px 16px; margin:8px 0; font-size:0.85rem; }
.vpn-box h4 { color:#3730a3; font-size:0.9rem; margin:0 0 6px; }
.tag { display:inline-block; padding:1px 6px; border-radius:3px; font-size:0.7rem; font-weight:600; margin:1px 2px; white-space:nowrap; }
.tag.p0 { background:#fce4e4; color:var(--red); }
.tag.p1 { background:#fff3cd; color:#856404; }
.missing-reason { font-size:0.78rem; color:var(--text2); }
.cat-header { padding:12px 16px; border-radius:8px; font-size:1.05rem; font-weight:700; margin:24px 0 10px; border-left:5px solid; }
.cat-header.cat-apps { background:#cfe2ff; color:#084298; border-color:#0d6efd; }
.cat-header.cat-accts { background:#e8daef; color:#6f42c1; border-color:#6f42c1; }
.cat-header.cat-files { background:#d1e7dd; color:#198754; border-color:#198754; }
.cat-header.cat-urls { background:#cff4fc; color:#087990; border-color:#0dcaf0; }
.cat-header.cat-env { background:#fff3cd; color:#856404; border-color:#fd7e14; }
.cat-header.cat-hw { background:#f8d7da; color:#dc3545; border-color:#dc3545; }
.cat-header.cat-preconf { background:#e9ecef; color:#495057; border-color:#6c757d; }
.req-tag { display:inline-block; padding:2px 8px; border-radius:10px; font-size:0.72rem; font-weight:600; margin:2px 3px; white-space:nowrap; }
.req-tag.apps { background:#cfe2ff; color:#084298; }
.req-tag.accounts { background:#e8daef; color:#6f42c1; }
.req-tag.files { background:#d1e7dd; color:#198754; }
.req-tag.urls { background:#cff4fc; color:#087990; }
.req-tag.environment { background:#fff3cd; color:#856404; }
.req-tag.hardware { background:#f8d7da; color:#dc3545; }
.req-tag.preconfig { background:#e9ecef; color:#495057; }
.checklist { list-style:none; padding:0; margin:8px 0; }
.checklist li { padding:4px 0; font-size:0.85rem; }
.checklist li::before { content:"☐ "; color:var(--text2); }
.detail-section { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:15px 20px; margin:15px 0; box-shadow:0 1px 3px rgba(0,0,0,0.05); }
.footer { margin-top:32px; padding-top:16px; border-top:1px solid var(--border); color:var(--text2); font-size:0.8rem; }
"""

# ═══════════════════════════════════════════════════════════════
#  Requirement category config
# ═══════════════════════════════════════════════════════════════

CATEGORIES = ["apps", "accounts", "files", "urls", "environment", "hardware", "preconfig"]

CATEGORY_CONFIG = {
    "apps":        {"icon": "📱", "string_key": "cat_apps",        "css": "cat-apps",    "css_tag": "apps"},
    "accounts":    {"icon": "🔐", "string_key": "cat_accounts",    "css": "cat-accts",   "css_tag": "accounts"},
    "files":       {"icon": "📁", "string_key": "cat_files",       "css": "cat-files",   "css_tag": "files"},
    "urls":        {"icon": "🔗", "string_key": "cat_urls",        "css": "cat-urls",    "css_tag": "urls"},
    "environment": {"icon": "🌐", "string_key": "cat_environment", "css": "cat-env",     "css_tag": "environment"},
    "hardware":    {"icon": "📲", "string_key": "cat_hardware",    "css": "cat-hw",      "css_tag": "hardware"},
    "preconfig":   {"icon": "📋", "string_key": "cat_preconfig",   "css": "cat-preconf", "css_tag": "preconfig"},
}

# ═══════════════════════════════════════════════════════════════
#  HTML building helpers
# ═══════════════════════════════════════════════════════════════


def html_head(title: str, lang: str = "en") -> str:
    """Return <!DOCTYPE> through <body><div class=container>, including CSS."""
    lang_attr = "zh-CN" if lang == "cn" else "en"
    return (
        f'<!DOCTYPE html>\n<html lang="{lang_attr}">\n<head>\n'
        f'<meta charset="UTF-8">\n<title>{_esc(title)}</title>\n'
        f'<style>\n{CSS}</style>\n</head>\n<body>\n<div class="container">\n'
    )


def html_foot(lang: str, date: str, file: str, n: int, report_type: str) -> str:
    """Return footer + closing tags."""
    text = S("footer_tpl", lang, date=date, file=file, n=n, report_type=report_type)
    return f'<div class="footer">{text}</div>\n</div>\n</body>\n</html>\n'


def summary_card(label: str, value, sub: str = "", css_class: str = "") -> str:
    """Render one summary card."""
    sub_html = f'<div class="sub">{_esc(sub)}</div>' if sub else ""
    return (
        f'<div class="summary-card {css_class}">'
        f'<div class="label">{_esc(label)}</div>'
        f'<div class="value">{value}</div>'
        f'{sub_html}'
        f'</div>\n'
    )


def _esc(text) -> str:
    """Escape HTML special characters."""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
