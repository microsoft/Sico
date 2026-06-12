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

"""
Unified Analysis Report renderer.
Reads analysis.jsonl (+ optional infra.json) → produces a single HTML dashboard
with tab-based navigation: Ready / Blocked / Prerequisite / Low Quality.

No LLM needed — all logic is deterministic.
"""
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from ..shared.loader import load_analysis, load_infra
from ..shared.i18n import S

# ═══════════════════════════════════════════════════════════════
#  Quality helpers (reused from quality renderer)
# ═══════════════════════════════════════════════════════════════

GROUP_A_ITEMS = ["A1_id", "A2_preconditions", "A3_steps", "A4_expected_result", "A5_app_platform"]
GROUP_B_ITEMS = ["B1_grounding", "B2_autonomy", "B3_granularity", "B4_reliability"]

CATEGORIES = ["apps", "accounts", "files", "urls", "environment", "hardware", "preconfig"]


def _compute_quality_decision(quality: dict) -> str:
    ga = quality.get("group_a", {})
    gb = quality.get("group_b", {})
    a_pass = all(ga.get(item, True) for item in GROUP_A_ITEMS)
    if not a_pass:
        return "blocked"
    b_pass = all(
        (gb.get(item, {}).get("pass", True) if isinstance(gb.get(item), dict) else gb.get(item, True))
        for item in GROUP_B_ITEMS
    )
    if not b_pass:
        return "rewrite_recommended"
    return "ready"


def _has_requirements(case: dict) -> bool:
    reqs = case.get("requirements", {})
    for cat in CATEGORIES:
        if reqs.get(cat):
            return True
    return False


# ═══════════════════════════════════════════════════════════════
#  Classify cases into 4 buckets
# ═══════════════════════════════════════════════════════════════

def _classify_cases(cases: list) -> dict:
    """
    Classify each case into exactly one bucket (first match wins):
      1. sandbox_blocked — sandbox.blocked=True and not view_only
      2. prerequisite_needed — has non-empty requirements
      3. low_quality — quality.decision != 'ready'
      4. ready — everything else
    """
    ready = []
    sandbox_blocked = []
    prereq_needed = []
    low_quality = []

    for c in cases:
        # Ensure quality decision is computed
        q = c.get("quality", {})
        if "decision" not in q:
            q["decision"] = _compute_quality_decision(q)
            c["quality"] = q

        # Bucket 1: sandbox blocked
        sb = c.get("sandbox", {})
        if sb.get("blocked") and not sb.get("view_only"):
            sandbox_blocked.append(c)
            continue

        # Bucket 2: prerequisite needed
        if _has_requirements(c):
            prereq_needed.append(c)
            continue

        # Bucket 3: low quality
        if q["decision"] != "ready":
            low_quality.append(c)
            continue

        # Bucket 4: ready
        ready.append(c)

    return {
        "ready": ready,
        "sandbox_blocked": sandbox_blocked,
        "prereq_needed": prereq_needed,
        "low_quality": low_quality,
    }


# ═══════════════════════════════════════════════════════════════
#  CSS (dashboard style — matches [final] report aesthetic)
# ═══════════════════════════════════════════════════════════════

UNIFIED_CSS = """\
:root {
  --bg:#f4f5f7; --card:#ffffff; --border:#e5e7eb; --text:#111827; --text2:#6b7280; --text3:#9ca3af;
  --accent:#2563eb; --accent-light:#3b82f6;
  --purple:#7c6cf6; --purple-dark:#6d5ee8; --purple-bg:#efedfe;
  --green:#16a34a; --green-bg:#dcfce7; --green-soft:#f0fdf4;
  --red:#dc2626; --red-bg:#fee2e2; --red-soft:#fef2f2;
  --orange:#ea580c; --orange-bg:#fed7aa; --orange-soft:#fff7ed;
  --yellow:#ca8a04; --yellow-bg:#fef3c7; --yellow-soft:#fefce8;
  --gray:#9ca3af; --gray-bg:#f3f4f6;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow:   0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
}
* { box-sizing:border-box; margin:0; padding:0; }
html, body { background:var(--bg); }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  color: var(--text); line-height: 1.55; padding: 36px 28px 48px;
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
.container { max-width: 1360px; margin: 0 auto; }
.report-title {
  font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 6px;
  color: var(--accent); line-height: 1.1;
}
.report-title .product { color: var(--accent); }
.report-title .sep { color: var(--text3); font-weight: 500; margin: 0 8px; }
.report-title .kind { color: var(--accent-light); }
.subtitle { color: var(--text2); margin-bottom: 28px; font-size: 0.92rem; }
.subtitle code {
  font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.88rem;
  background: #eef0f3; padding: 1px 6px; border-radius: 4px; color: var(--text);
}
.summary-bar {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 30px;
}
.summary-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 14px;
  padding: 18px 20px; box-shadow: var(--shadow-sm);
  display: flex; flex-direction: column; min-height: 140px;
}
.summary-card .label { font-size: 0.88rem; color: var(--text); font-weight: 600; margin-bottom: 6px; }
.summary-card .desc { font-size: 0.78rem; color: var(--text2); flex: 1; line-height: 1.4; }
.summary-card .value { font-size: 1.05rem; font-weight: 700; color: var(--text); margin-top: 10px; }
.summary-card.total { align-items: center; justify-content: center; text-align: center; }
.summary-card.total .label { color: var(--text2); font-weight: 500; }
.summary-card.total .big-value {
  font-size: 2.6rem; font-weight: 800; color: var(--accent); line-height: 1; margin: 6px 0 8px;
}
.summary-card.total .sub { font-size: 0.78rem; color: var(--text2); }
.tabs { display: flex; gap: 10px; margin-bottom: 22px; flex-wrap: wrap; }
.tab {
  border: none; background: var(--gray-bg); color: var(--text);
  padding: 9px 18px; border-radius: 9px; font-size: 0.9rem; font-weight: 500;
  cursor: pointer; transition: all 0.15s ease; font-family: inherit;
}
.tab:hover { background: #e5e7eb; }
.tab.active {
  background: var(--purple); color: white; font-weight: 600;
  box-shadow: 0 2px 8px rgba(124,108,246,0.3);
}
.panel { display: none; }
.panel.active { display: block; }
.panel-intro { color: var(--text2); font-size: 0.9rem; margin-bottom: 18px; line-height: 1.6; }
.data-table {
  width: 100%; border-collapse: collapse; background: var(--card);
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
  font-size: 0.86rem; box-shadow: var(--shadow-sm);
}
.data-table th {
  background: #f9fafb; color: var(--text2); padding: 10px 14px;
  text-align: left; font-size: 0.76rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
}
.data-table td { padding: 11px 14px; border-bottom: 1px solid #f1f3f5; vertical-align: top; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: #fafbfc; }
.case-id {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  color: var(--accent); font-weight: 600; font-size: 0.82rem; white-space: nowrap;
}
.col-num { color: var(--text3); width: 36px; font-variant-numeric: tabular-nums; }
.col-id  { width: 130px; }
.section-heading {
  font-size: 1.05rem; font-weight: 700; margin: 30px 0 12px; color: var(--text);
  padding-bottom: 8px; border-bottom: 2px solid var(--accent); display: inline-block;
}
.section-heading:first-child { margin-top: 0; }
.banner {
  border-radius: 10px; padding: 14px 18px; margin-bottom: 16px;
  display: flex; align-items: center; gap: 10px; font-size: 0.9rem;
}
.banner.red { background: var(--red-soft); border: 1px solid var(--red-bg); color: #991b1b; }
.banner.orange { background: var(--orange-soft); border: 1px solid var(--orange-bg); color: #9a3412; }
.banner.green { background: var(--green-soft); border: 1px solid var(--green-bg); color: #166534; }
.banner.yellow { background: var(--yellow-soft); border: 1px solid var(--yellow-bg); color: #854d0e; }
.banner-title { font-weight: 700; }
.banner-sub { font-size: 0.82rem; opacity: 0.85; }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 0.72rem; font-weight: 600; white-space: nowrap;
}
.badge.red    { background: var(--red-bg); color: var(--red); }
.badge.orange { background: var(--orange-bg); color: var(--orange); }
.badge.green  { background: var(--green-bg); color: var(--green); }
.badge.yellow { background: var(--yellow-bg); color: var(--yellow); }
.badge.gray   { background: var(--gray-bg); color: var(--text2); }
.badge.purple { background: var(--purple-bg); color: var(--purple-dark); }
.tag-pill {
  display: inline-block; padding: 3px 10px; border-radius: 12px;
  font-size: 0.74rem; font-weight: 600; margin: 1px 0;
}
.tag-pill.files  { background: var(--green-bg); color: var(--green); }
.tag-pill.accounts { background: var(--purple-bg); color: var(--purple-dark); }
.tag-pill.apps { background: #cfe2ff; color: #084298; }
.tag-pill.urls { background: #cff4fc; color: #087990; }
.tag-pill.environment { background: var(--yellow-bg); color: var(--yellow); }
.tag-pill.hardware { background: var(--red-bg); color: var(--red); }
.tag-pill.preconfig { background: var(--gray-bg); color: var(--text2); }
.issue-line {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 0.82rem; margin: 3px 0;
}
.issue-line .reason { color: var(--text2); line-height: 1.4; }
.cat-header {
  padding: 10px 14px; border-radius: 8px; font-size: 0.92rem; font-weight: 700;
  margin: 18px 0 10px; border-left: 4px solid;
}
.cat-header.cat-struct { background: var(--red-soft); color: var(--red); border-color: var(--red); }
.cat-header.cat-desc  { background: var(--yellow-soft); color: var(--yellow); border-color: var(--yellow); }
.cat-header.cat-files { background: var(--green-soft); color: var(--green); border-color: var(--green); }
.cat-header.cat-accts { background: var(--purple-bg); color: var(--purple-dark); border-color: var(--purple); }
.cat-header.cat-apps { background: #dbeafe; color: #1d4ed8; border-color: var(--accent); }
.cat-header.cat-urls { background: #cff4fc; color: #087990; border-color: #0dcaf0; }
.cat-header.cat-env { background: var(--yellow-soft); color: var(--yellow); border-color: var(--orange); }
.cat-header.cat-hw { background: var(--red-soft); color: var(--red); border-color: var(--red); }
.cat-header.cat-preconf { background: var(--gray-bg); color: var(--text2); border-color: var(--gray); }
.footer {
  margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--border);
  color: var(--text3); font-size: 0.78rem;
}
@media (max-width: 1100px) {
  .summary-bar { grid-template-columns: repeat(2, 1fr); }
  .summary-card.total { grid-column: 1 / -1; }
}
@media (max-width: 640px) {
  body { padding: 20px 14px; }
  .summary-bar { grid-template-columns: 1fr; }
  .report-title { font-size: 1.5rem; }
}
"""

TAB_JS = """\
<script>
(function () {
  var tabs = document.querySelectorAll('.tab');
  var panels = {
    ready:   document.getElementById('panel-ready'),
    sandbox: document.getElementById('panel-sandbox'),
    prereq:  document.getElementById('panel-prereq'),
    quality: document.getElementById('panel-quality')
  };
  tabs.forEach(function(t) {
    t.addEventListener('click', function() {
      tabs.forEach(function(x) { x.classList.remove('active'); });
      Object.keys(panels).forEach(function(k) { panels[k].classList.remove('active'); });
      t.classList.add('active');
      panels[t.dataset.tab].classList.add('active');
    });
  });
})();
</script>
"""


# ═══════════════════════════════════════════════════════════════
#  HTML helpers
# ═══════════════════════════════════════════════════════════════

def _esc(text) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# ═══════════════════════════════════════════════════════════════
#  Panel renderers
# ═══════════════════════════════════════════════════════════════

def _render_ready_panel(cases: list, lang: str) -> str:
    h = []
    h.append('<div class="panel active" id="panel-ready">\n')
    h.append('<p class="panel-intro">')
    h.append('After analysis, the following test cases are within the sandbox scope, '
             'and the prerequisite materials are complete and clearly written. '
             'Direct execution can yield good results.')
    h.append('</p>\n')

    if not cases:
        h.append('<p style="color:var(--text2)">No cases are ready for direct execution.</p>\n')
    else:
        h.append('<table class="data-table"><thead>\n')
        h.append(f'<tr><th class="col-num">#</th><th class="col-id">Case ID</th><th>Title</th></tr>\n')
        h.append('</thead><tbody>\n')
        for i, c in enumerate(cases, 1):
            h.append(f'<tr><td class="col-num">{i}</td>')
            h.append(f'<td><span class="case-id">{_esc(c.get("case_id", ""))}</span></td>')
            h.append(f'<td>{_esc(c.get("title", ""))}</td></tr>\n')
        h.append('</tbody></table>\n')

    h.append('</div>\n')
    return "".join(h)


def _render_sandbox_panel(cases: list, total: int, lang: str) -> str:
    h = []
    h.append('<div class="panel" id="panel-sandbox">\n')

    n = len(cases)
    if n > 0:
        h.append('<div class="banner red"><div>')
        h.append(f'<div class="banner-title">⛔ Sandbox Blocked</div>')
        h.append(f'<div class="banner-sub">{n} / {total} cases blocked — outside current sandbox capability</div>')
        h.append('</div></div>\n')

        h.append('<table class="data-table"><thead>\n')
        h.append('<tr><th class="col-num">#</th><th class="col-id">Case ID</th><th>Title</th><th>Reason</th></tr>\n')
        h.append('</thead><tbody>\n')
        for i, c in enumerate(cases, 1):
            sb = c.get("sandbox", {})
            reason = sb.get("block_category", "") or ""
            h.append(f'<tr><td class="col-num">{i}</td>')
            h.append(f'<td><span class="case-id">{_esc(c.get("case_id", ""))}</span></td>')
            h.append(f'<td>{_esc(c.get("title", ""))}</td>')
            h.append(f'<td>{_esc(reason)}</td></tr>\n')
        h.append('</tbody></table>\n')
    else:
        h.append('<div class="banner green"><div>')
        h.append('<div class="banner-title">✅ No Sandbox Blockers</div>')
        h.append('<div class="banner-sub">All cases are within sandbox capability.</div>')
        h.append('</div></div>\n')

    h.append('</div>\n')
    return "".join(h)


CAT_ICON = {
    "apps": "📱", "accounts": "🔐", "files": "📁", "urls": "🔗",
    "environment": "🌐", "hardware": "📲", "preconfig": "📋",
}
CAT_CSS = {
    "apps": "cat-apps", "accounts": "cat-accts", "files": "cat-files",
    "urls": "cat-urls", "environment": "cat-env", "hardware": "cat-hw",
    "preconfig": "cat-preconf",
}
CAT_LABEL = {
    "apps": "Apps to Download", "accounts": "Account Credentials",
    "files": "Required Files", "urls": "Required URLs",
    "environment": "Special Environment", "hardware": "Hardware Requirements",
    "preconfig": "Pre-configured Data",
}


def _render_prereq_panel(cases: list, lang: str) -> str:
    h = []
    h.append('<div class="panel" id="panel-prereq">\n')

    if not cases:
        h.append('<p style="color:var(--text2)">No prerequisite gaps detected.</p>\n')
        h.append('</div>\n')
        return "".join(h)

    # Aggregate requirements by category
    agg: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}
    for c in cases:
        reqs = c.get("requirements", {})
        for cat in CATEGORIES:
            for item in reqs.get(cat, []):
                entry = dict(item)
                entry["_case_id"] = c.get("case_id", "")
                agg[cat].append(entry)

    # Requirements Summary section
    h.append('<h3 class="section-heading">Requirements Summary</h3>\n')

    for cat in CATEGORIES:
        items = agg[cat]
        if not items:
            continue
        icon = CAT_ICON[cat]
        css = CAT_CSS[cat]
        label = CAT_LABEL[cat]
        # Group items by a reasonable key
        grouped = _group_req_items(cat, items)
        h.append(f'<div class="cat-header {css}">{icon} {label} ({len(grouped)})</div>\n')
        h.append(_render_req_summary_table(cat, grouped))

    # Per-Case Requirements section
    h.append('<h3 class="section-heading">Per-Case Requirements</h3>\n')
    h.append('<table class="data-table"><thead>\n')
    h.append('<tr><th class="col-num">#</th><th class="col-id">Case ID</th><th>Title</th><th>Requirements</th></tr>\n')
    h.append('</thead><tbody>\n')
    for i, c in enumerate(cases, 1):
        reqs = c.get("requirements", {})
        pills = []
        for cat in CATEGORIES:
            cat_items = reqs.get(cat, [])
            if cat_items:
                for item in cat_items:
                    desc = _req_pill_text(cat, item)
                    pills.append(f'<span class="tag-pill {cat}">{CAT_ICON[cat]} {_esc(desc)}</span>')
        pills_html = " ".join(pills) if pills else "—"
        h.append(f'<tr><td class="col-num">{i}</td>')
        h.append(f'<td><span class="case-id">{_esc(c.get("case_id", ""))}</span></td>')
        h.append(f'<td>{_esc(c.get("title", ""))}</td>')
        h.append(f'<td>{pills_html}</td></tr>\n')
    h.append('</tbody></table>\n')

    h.append('</div>\n')
    return "".join(h)


def _group_req_items(cat: str, items: list) -> list[dict]:
    """Group requirement items by a natural key, returning merged rows."""
    groups: dict[str, dict] = {}
    for item in items:
        if cat == "files":
            key = (item.get("type", "file"), item.get("location", "device"))
        elif cat == "accounts":
            key = item.get("type", "Unknown")
        elif cat == "apps":
            key = item.get("name", "Unknown")
        elif cat == "urls":
            key = item.get("url", "") or item.get("type", "url")
        else:
            key = item.get("type", "") or item.get("data_type", "item")

        if key not in groups:
            groups[key] = {"key": key, "items": [], "case_ids": set()}
        groups[key]["items"].append(item)
        groups[key]["case_ids"].add(item.get("_case_id", ""))

    return sorted(groups.values(), key=lambda g: -len(g["case_ids"]))


def _render_req_summary_table(cat: str, grouped: list) -> str:
    h = ['<table class="data-table"><thead>\n']
    if cat == "files":
        h.append('<tr><th>File Type</th><th>Quantity</th><th>Properties</th><th>Location</th><th>Referenced Cases</th></tr>\n')
    elif cat == "accounts":
        h.append('<tr><th>Account Type</th><th>Sign-in Method</th><th>Special</th><th>Referenced Cases</th></tr>\n')
    elif cat == "apps":
        h.append('<tr><th>App Name</th><th>Purpose</th><th>Referenced Cases</th></tr>\n')
    else:
        h.append('<tr><th>Type</th><th>Detail</th><th>Referenced Cases</th></tr>\n')
    h.append('</thead><tbody>\n')

    for g in grouped:
        ids_str = ", ".join(sorted(g["case_ids"]))
        items = g["items"]
        if cat == "files":
            ftype = items[0].get("type", "file")
            loc = items[0].get("location", "device")
            qtys = [int(it.get("quantity", 1)) for it in items if it.get("quantity")]
            qty = f"{max(qtys) if qtys else 1}+"
            props = sorted(set(it.get("properties", "") for it in items if it.get("properties")))
            h.append(f'<tr><td>{_esc(ftype)}</td><td>{qty}</td><td>{_esc(", ".join(props))}</td>')
            h.append(f'<td>{_esc(loc)}</td><td><span class="case-id">{_esc(ids_str)}</span></td></tr>\n')
        elif cat == "accounts":
            atype = items[0].get("type", "Unknown")
            methods = sorted(set(it.get("method", "") for it in items if it.get("method")))
            specials = sorted(set(it.get("special", "") for it in items if it.get("special")))
            h.append(f'<tr><td>{_esc(atype)}</td><td>{_esc(", ".join(methods))}</td>')
            h.append(f'<td>{_esc(", ".join(specials))}</td><td><span class="case-id">{_esc(ids_str)}</span></td></tr>\n')
        elif cat == "apps":
            name = items[0].get("name", "Unknown")
            purposes = sorted(set(it.get("purpose", "") for it in items if it.get("purpose")))
            h.append(f'<tr><td>{_esc(name)}</td><td>{_esc(", ".join(purposes))}</td>')
            h.append(f'<td><span class="case-id">{_esc(ids_str)}</span></td></tr>\n')
        else:
            detail_key = "type" if cat != "preconfig" else "data_type"
            dtype = items[0].get(detail_key, "") or items[0].get("type", "")
            details = sorted(set(
                it.get("detail", "") or it.get("value", "") or it.get("url", "")
                for it in items
                if it.get("detail") or it.get("value") or it.get("url")
            ))
            h.append(f'<tr><td>{_esc(dtype)}</td><td>{_esc(", ".join(details))}</td>')
            h.append(f'<td><span class="case-id">{_esc(ids_str)}</span></td></tr>\n')

    h.append('</tbody></table>\n')
    return "".join(h)


def _req_pill_text(cat: str, item: dict) -> str:
    if cat == "files":
        qty = item.get("quantity", 1)
        return f'{item.get("type", "file")} ×{qty}'
    elif cat == "accounts":
        return item.get("type", "account")
    elif cat == "apps":
        return item.get("name", "app")
    elif cat == "urls":
        return item.get("type", "") or "URL"
    elif cat == "hardware":
        return item.get("type", "hardware")
    elif cat == "environment":
        return item.get("type", "env")
    else:
        return item.get("data_type", "") or item.get("type", "data")


def _render_quality_panel(cases: list, lang: str) -> str:
    h = []
    h.append('<div class="panel" id="panel-quality">\n')

    if not cases:
        h.append('<p style="color:var(--text2)">All test cases pass quality checks.</p>\n')
        h.append('</div>\n')
        return "".join(h)

    # Issues Overview
    h.append('<h3 class="section-heading">Issues Overview</h3>\n')

    a_fails: dict[str, int] = defaultdict(int)
    b_fails: dict[str, list[str]] = defaultdict(list)
    for c in cases:
        q = c.get("quality", {})
        ga = q.get("group_a", {})
        gb = q.get("group_b", {})
        for item in GROUP_A_ITEMS:
            if not ga.get(item, True):
                a_fails[item] += 1
        for item in GROUP_B_ITEMS:
            val = gb.get(item, {})
            passed = val.get("pass", True) if isinstance(val, dict) else val
            if not passed:
                b_fails[item].append(c.get("case_id", ""))

    # Group A table
    if a_fails:
        h.append('<div class="cat-header cat-struct">Group A — Structural Completeness</div>\n')
        h.append('<table class="data-table"><thead><tr><th>Check Item</th><th>Failures</th><th>Notes</th></tr></thead><tbody>\n')
        a_notes = {
            "A2_preconditions": "Starting state not defined",
            "A3_steps": "Step granularity insufficient for replay",
            "A4_expected_result": "No concrete success criteria",
            "A1_id": "Missing unique identifier",
            "A5_app_platform": "Target app/platform not stated",
        }
        for item in GROUP_A_ITEMS:
            if item in a_fails:
                short = S(f"q_{item}", lang)
                note = a_notes.get(item, "")
                h.append(f'<tr><td>{_esc(short)}</td><td><span class="badge red">{a_fails[item]}</span></td><td>{_esc(note)}</td></tr>\n')
        h.append('</tbody></table>\n')

    # Group B table
    if b_fails:
        h.append('<div class="cat-header cat-desc">Group B — Description Quality</div>\n')
        h.append('<table class="data-table"><thead><tr><th>Check Item</th><th>Failures</th><th>Referenced Cases</th></tr></thead><tbody>\n')
        for item in GROUP_B_ITEMS:
            if item in b_fails:
                short = S(f"q_{item}", lang)
                ids = b_fails[item]
                ids_str = ", ".join(ids[:5])
                if len(ids) > 5:
                    ids_str += f" +{len(ids) - 5}"
                h.append(f'<tr><td>{_esc(short)}</td><td><span class="badge orange">{len(ids)}</span></td>')
                h.append(f'<td><span class="case-id">{_esc(ids_str)}</span></td></tr>\n')
        h.append('</tbody></table>\n')

    # Per-Case Quality Detail
    h.append('<h3 class="section-heading">Per-Case Quality Detail</h3>\n')

    n = len(cases)
    h.append(f'<div class="banner red"><div>')
    h.append(f'<div class="banner-title">⛔ Blocked — Fix Required ({n})</div>')
    h.append(f'<div class="banner-sub">These cases cannot be executed reliably until the issues below are addressed.</div>')
    h.append('</div></div>\n')

    h.append('<table class="data-table"><thead>\n')
    h.append('<tr><th class="col-num">#</th><th class="col-id">Case ID</th><th>Title</th>')
    h.append('<th>Group A</th><th>Group B</th><th>Issues</th></tr>\n')
    h.append('</thead><tbody>\n')

    for i, c in enumerate(cases, 1):
        q = c.get("quality", {})
        ga = q.get("group_a", {})
        gb = q.get("group_b", {})

        a_failed = [item for item in GROUP_A_ITEMS if not ga.get(item, True)]
        b_failed = []
        for item in GROUP_B_ITEMS:
            val = gb.get(item, {})
            passed = val.get("pass", True) if isinstance(val, dict) else val
            if not passed:
                b_failed.append((item, val.get("detail", "") if isinstance(val, dict) else ""))

        a_str = f'<span class="badge red">⛔ {len(a_failed)} fail</span>' if a_failed else '<span class="badge green">✅</span>'
        b_str = f'<span class="badge orange">⚠ {len(b_failed)} warn</span>' if b_failed else '<span class="badge green">✅</span>'

        issues_parts = []
        for item in a_failed:
            short = S(f"q_{item}_short", lang)
            issues_parts.append(f'<span class="badge red">{_esc(short)}</span>')
        for item, detail in b_failed:
            short = S(f"q_{item}_short", lang)
            if detail:
                issues_parts.append(
                    f'<div class="issue-line"><span class="badge orange">{_esc(short)}</span>'
                    f'<span class="reason">{_esc(detail)}</span></div>'
                )
            else:
                issues_parts.append(f'<span class="badge orange">{_esc(short)}</span>')

        # Join Group A badges on one line, then Group B issue-lines below
        a_badges = [p for p in issues_parts if 'badge red' in p]
        b_issues = [p for p in issues_parts if 'badge red' not in p]
        issues_html = " ".join(a_badges)
        if a_badges and b_issues:
            issues_html += "<br>"
        issues_html += "\n".join(b_issues)

        h.append(f'<tr><td class="col-num">{i}</td>')
        h.append(f'<td><span class="case-id">{_esc(c.get("case_id", ""))}</span></td>')
        h.append(f'<td>{_esc(c.get("title", ""))}</td>')
        h.append(f'<td>{a_str}</td><td>{b_str}</td>')
        h.append(f'<td>{issues_html}</td></tr>\n')

    h.append('</tbody></table>\n')
    h.append('</div>\n')
    return "".join(h)


# ═══════════════════════════════════════════════════════════════
#  Main render
# ═══════════════════════════════════════════════════════════════

def render(
    analysis_path: Path,
    infra_path: Path | None,
    output_dir: Path,
    *,
    langs: tuple[str, ...] = ("en",),
):
    """Main entry: render unified analysis report."""
    data = load_analysis(analysis_path)
    meta = data["meta"]
    cases = data["cases"]

    # Ensure quality decisions are computed
    for c in cases:
        q = c.get("quality", {})
        if "decision" not in q:
            q["decision"] = _compute_quality_decision(q)
            c["quality"] = q

    buckets = _classify_cases(cases)

    prefix = Path(meta.get("input_file", "analysis")).stem
    date = meta.get("generated_at", datetime.now().strftime("%Y-%m-%d"))
    app = meta.get("app", "")
    platform = meta.get("platform", "")

    for lang in langs:
        html = _render_html(lang, meta, cases, buckets, date, prefix, app, platform)
        suffix = "en" if lang == "en" else "cn"
        out_path = output_dir / f"{prefix}_unified_analysis_{suffix}.html"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote: {out_path}")


def _render_html(lang, meta, cases, buckets, date, prefix, app, platform):
    h = []
    total = len(cases)
    n_ready = len(buckets["ready"])
    n_blocked = len(buckets["sandbox_blocked"])
    n_prereq = len(buckets["prereq_needed"])
    n_quality = len(buckets["low_quality"])
    file_name = meta.get("input_file", "")

    # Collect features
    features = sorted(set(c.get("feature", "Other") for c in cases))
    n_features = len(features)

    lang_attr = "zh-CN" if lang == "cn" else "en"
    title_text = f"{app} {platform} — Analysis Report" if app else "Analysis Report"

    # Head
    h.append(f'<!DOCTYPE html>\n<html lang="{lang_attr}">\n<head>\n')
    h.append(f'<meta charset="UTF-8">\n<title>{_esc(title_text)}</title>\n')
    h.append(f'<style>\n{UNIFIED_CSS}</style>\n</head>\n<body>\n<div class="container">\n')

    # Header
    if app:
        h.append(f'<h1 class="report-title"><span class="product">{_esc(app)} {_esc(platform)}</span>')
        h.append(f'<span class="sep">—</span><span class="kind">Analysis Report</span></h1>\n')
    else:
        h.append('<h1 class="report-title">Analysis Report</h1>\n')

    h.append(f'<p class="subtitle">{total} test cases · {n_features} feature{"s" if n_features != 1 else ""} · '
             f'Generated on {date} · Source: <code>{_esc(file_name)}</code></p>\n')

    # Summary cards
    h.append('<div class="summary-bar">\n')
    h.append(f'<div class="summary-card total"><div class="label">Total</div>')
    h.append(f'<div class="big-value">{total}</div>')
    h.append(f'<div class="sub">{n_features} feature{"s" if n_features != 1 else ""} · {total} cases</div></div>\n')

    h.append(f'<div class="summary-card"><div class="label">Ready to Execute</div>')
    h.append(f'<div class="desc">Can be executed directly</div>')
    h.append(f'<div class="value">{n_ready} Test Case{"s" if n_ready != 1 else ""}</div></div>\n')

    h.append(f'<div class="summary-card"><div class="label">Blocked by Sandbox</div>')
    h.append(f'<div class="desc">Outside current sandbox capability</div>')
    h.append(f'<div class="value">{n_blocked} Test Case{"s" if n_blocked != 1 else ""}</div></div>\n')

    h.append(f'<div class="summary-card"><div class="label">Prerequisite Needed</div>')
    h.append(f'<div class="desc">Needs prerequisites before execution</div>')
    h.append(f'<div class="value">{n_prereq} Test Case{"s" if n_prereq != 1 else ""}</div></div>\n')

    h.append(f'<div class="summary-card"><div class="label">Low Quality</div>')
    h.append(f'<div class="desc">Direct execution yields poor results; rewriting is recommended</div>')
    h.append(f'<div class="value">{n_quality} Test Case{"s" if n_quality != 1 else ""}</div></div>\n')

    h.append('</div>\n')

    # Tabs
    h.append('<div class="tabs">\n')
    h.append('<button class="tab active" data-tab="ready">Ready to Execute</button>\n')
    h.append('<button class="tab" data-tab="sandbox">Blocked by Sandbox</button>\n')
    h.append('<button class="tab" data-tab="prereq">Prerequisite Needed</button>\n')
    h.append('<button class="tab" data-tab="quality">Low Quality</button>\n')
    h.append('</div>\n')

    # Panels
    h.append(_render_ready_panel(buckets["ready"], lang))
    h.append(_render_sandbox_panel(buckets["sandbox_blocked"], total, lang))
    h.append(_render_prereq_panel(buckets["prereq_needed"], lang))
    h.append(_render_quality_panel(buckets["low_quality"], lang))

    # Footer
    h.append(f'<div class="footer">Generated on {_esc(date)} · Input: {_esc(file_name)} ({total} cases) · Unified Executability + Prerequisite + Quality Analysis</div>\n')

    # Tab JS
    h.append(TAB_JS)

    h.append('</div>\n</body>\n</html>\n')
    return "".join(h)
