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
Requirement report renderer.
Reads analysis.jsonl → aggregates requirements → produces bilingual HTML + TSV.

No LLM needed — all logic is deterministic.
"""
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from ..shared.i18n import S
from ..shared.html_engine import (
    html_head, html_foot, summary_card, _esc,
    CATEGORIES, CATEGORY_CONFIG,
)
from ..shared.loader import load_analysis

# ═══════════════════════════════════════════════════════════════
#  Aggregation
# ═══════════════════════════════════════════════════════════════


def _aggregate(cases: list) -> dict:
    """
    Aggregate per-case requirements into category-level summaries.

    Returns:
        {
            "apps": [{"name": ..., "purpose": ..., "case_ids": [...]}],
            "accounts": [...],
            ...
            "stats": {"total": N, "with_reqs": N, "blocked": N, "category_counts": {...}}
        }
    """
    # Collect per-category items
    raw = {cat: defaultdict(lambda: {"case_ids": [], "items": []}) for cat in CATEGORIES}

    blocked_count = 0
    with_reqs = 0

    for c in cases:
        cid = c.get("case_id", "")
        if c.get("sandbox", {}).get("blocked") and not c.get("sandbox", {}).get("view_only"):
            blocked_count += 1
            continue

        reqs = c.get("requirements", {})
        has_any = False

        # Apps: group by name
        for item in reqs.get("apps", []):
            key = item.get("name", "Unknown")
            raw["apps"][key]["case_ids"].append(cid)
            raw["apps"][key]["items"].append(item)
            has_any = True

        # Accounts: group by type
        for item in reqs.get("accounts", []):
            key = item.get("type", "Unknown")
            raw["accounts"][key]["case_ids"].append(cid)
            raw["accounts"][key]["items"].append(item)
            has_any = True

        # Files: group by (type, location)
        for item in reqs.get("files", []):
            key = (item.get("type", "file"), item.get("location", "device"))
            raw["files"][key]["case_ids"].append(cid)
            raw["files"][key]["items"].append(item)
            has_any = True

        # URLs: group by url or type
        for item in reqs.get("urls", []):
            key = item.get("url", "") or item.get("type", "url")
            raw["urls"][key]["case_ids"].append(cid)
            raw["urls"][key]["items"].append(item)
            has_any = True

        # Environment: group by type
        for item in reqs.get("environment", []):
            key = item.get("type", "env")
            raw["environment"][key]["case_ids"].append(cid)
            raw["environment"][key]["items"].append(item)
            has_any = True

        # Hardware: group by type
        for item in reqs.get("hardware", []):
            key = item.get("type", "hw")
            raw["hardware"][key]["case_ids"].append(cid)
            raw["hardware"][key]["items"].append(item)
            has_any = True

        # Preconfig: group by data_type
        for item in reqs.get("preconfig", []):
            key = item.get("data_type", "data")
            raw["preconfig"][key]["case_ids"].append(cid)
            raw["preconfig"][key]["items"].append(item)
            has_any = True

        if has_any:
            with_reqs += 1

    # Merge into summary rows
    summary = {}
    category_counts = {}
    for cat in CATEGORIES:
        rows = []
        for key, data in sorted(raw[cat].items(), key=lambda x: -len(x[1]["case_ids"])):
            unique_ids = sorted(set(data["case_ids"]))
            items = data["items"]
            merged = _merge_items(cat, key, items, unique_ids)
            rows.append(merged)
        summary[cat] = rows
        category_counts[cat] = len(rows)

    summary["stats"] = {
        "total": len(cases),
        "with_reqs": with_reqs,
        "blocked": blocked_count,
        "category_counts": category_counts,
    }
    return summary


def _merge_items(cat: str, key, items: list, case_ids: list) -> dict:
    """Merge multiple items of the same key into one summary row."""
    if cat == "apps":
        purposes = sorted(set(it.get("purpose", "") for it in items if it.get("purpose")))
        states = sorted(set(it.get("state", "") for it in items if it.get("state")))
        return {"name": key, "purpose": ", ".join(purposes), "state": ", ".join(states), "case_ids": case_ids}

    elif cat == "accounts":
        methods = sorted(set(it.get("method", "") for it in items if it.get("method")))
        specials = sorted(set(it.get("special", "") for it in items if it.get("special")))
        credentials = sorted(set(it.get("credential", "") for it in items if it.get("credential")))
        return {"type": key, "method": ", ".join(methods), "credential": ", ".join(credentials),
                "special": ", ".join(specials), "case_ids": case_ids}

    elif cat == "files":
        file_type, location = key if isinstance(key, tuple) else (key, "device")
        quantities = [int(it.get("quantity", 1)) for it in items if it.get("quantity")]
        max_qty = max(quantities) if quantities else 1
        sizes = sorted(set(it.get("size", "") for it in items if it.get("size")))
        props = sorted(set(it.get("properties", "") for it in items if it.get("properties")))
        return {"type": file_type, "quantity": f"{max_qty}+", "size": ", ".join(sizes),
                "properties": ", ".join(props), "location": location, "case_ids": case_ids}

    elif cat == "urls":
        purposes = sorted(set(it.get("purpose", "") for it in items if it.get("purpose")))
        types = sorted(set(it.get("type", "") for it in items if it.get("type")))
        return {"url": key, "type": ", ".join(types), "purpose": ", ".join(purposes), "case_ids": case_ids}

    elif cat in ("environment", "hardware"):
        values = sorted(set(it.get("value", it.get("detail", "")) for it in items if it.get("value") or it.get("detail")))
        return {"type": key, "value": ", ".join(values), "case_ids": case_ids}

    elif cat == "preconfig":
        quantities = [int(it.get("quantity", 1)) for it in items if it.get("quantity")]
        max_qty = max(quantities) if quantities else 1
        details = sorted(set(it.get("detail", "") for it in items if it.get("detail")))
        return {"data_type": key, "quantity": str(max_qty), "detail": ", ".join(details), "case_ids": case_ids}

    return {"key": key, "case_ids": case_ids}


# ═══════════════════════════════════════════════════════════════
#  HTML generation
# ═══════════════════════════════════════════════════════════════

def render(analysis_path: Path, output_dir: Path, *, langs: tuple[str, ...] = ("en",)):
    """Main entry: render prerequisite gap analysis report + TSV."""
    data = load_analysis(analysis_path)
    meta = data["meta"]
    cases = data["cases"]

    summary = _aggregate(cases)
    stats = summary["stats"]

    prefix = Path(meta.get("input_file", "analysis")).stem
    date = meta.get("generated_at", datetime.now().strftime("%Y-%m-%d"))
    app = meta.get("app", "")
    platform = meta.get("platform", "")

    for lang in langs:
        html = _render_html(lang, meta, cases, summary, stats, date, prefix, app, platform)
        suffix = "en" if lang == "en" else "cn"
        out_path = output_dir / f"{prefix}_prerequisite_gap_analysis_{suffix}.html"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote: {out_path}")

    # TSV
    tsv_path = output_dir / f"{prefix}_prerequisite_gap_analysis.tsv"
    _render_tsv(tsv_path, cases, summary)
    print(f"Wrote: {tsv_path}")


def _render_html(lang, meta, cases, summary, stats, date, prefix, app, platform):
    h = []
    title = f"{app} {platform} — {S('requirement_title', lang)}"
    h.append(html_head(title, lang))

    # Count non-empty categories
    n_cats = sum(1 for cat in CATEGORIES if summary.get(cat))

    # Title
    h.append(f'<h1>{_esc(title)}</h1>\n')
    h.append(f'<p class="subtitle">{S("requirement_subtitle_tpl", lang, n_cases=stats["total"], n_cats=n_cats, date=date, file=meta.get("input_file", ""))}</p>\n')

    # ── Section 1: Summary cards ──
    h.append('<div class="summary-bar">\n')
    h.append(summary_card(S("total_cases", lang), stats["total"], f'{stats["total"]} {S("cases_analyzed", lang)}', "total"))
    pct = round(100 * stats["with_reqs"] / stats["total"]) if stats["total"] else 0
    h.append(summary_card(S("with_reqs", lang), stats["with_reqs"], f'{pct}% {S("of_total", lang)}', "with-reqs"))
    if stats["blocked"] > 0:
        h.append(summary_card(S("blocked", lang), stats["blocked"], S("blocked_sub", lang, c=stats["blocked"]), "red"))
    for cat in CATEGORIES:
        cfg = CATEGORY_CONFIG[cat]
        rows = summary.get(cat, [])
        if not rows:
            continue
        count = len(rows)
        case_count = len({cid for r in rows for cid in r.get("case_ids", [])})
        h.append(summary_card(S(cfg["string_key"], lang), count, f'{count} {S("unique_items", lang)} \u00b7 {case_count} {S("cases_lc", lang)}', cfg["css"]))
    h.append('</div>\n')

    # ── Section 2: Requirements Summary ──
    h.append(f'<h2>{S("summary_section", lang)}</h2>\n')

    for cat in CATEGORIES:
        rows = summary.get(cat, [])
        if not rows:
            continue
        cfg = CATEGORY_CONFIG[cat]
        h.append(f'<div class="cat-header {cfg["css"]}">{S(cfg["string_key"], lang)} ({len(rows)})</div>\n')
        h.append(_category_table(cat, rows, lang))

    # ── Section 3: Per-case detail ──
    h.append(f'<h2>{S("detail_section", lang)}</h2>\n')
    h.append(f'<table class="case-table"><tr><th>#</th><th>{S("col_case_id", lang)}</th>')
    h.append(f'<th>{S("col_title", lang)}</th><th>{S("col_requirements", lang)}</th></tr>\n')

    # Sort: cases with reqs first, then no reqs, then blocked
    def sort_key(c):
        reqs = c.get("requirements", {})
        is_blocked = c.get("sandbox", {}).get("blocked") and not c.get("sandbox", {}).get("view_only")
        has = any(reqs.get(cat) for cat in CATEGORIES)
        return (2 if is_blocked else (0 if has else 1), c.get("case_id", ""))

    sorted_cases = sorted(cases, key=sort_key)
    for i, c in enumerate(sorted_cases, 1):
        cid = c.get("case_id", "")
        title_text = c.get("title", "")[:100]
        is_blocked = c.get("sandbox", {}).get("blocked") and not c.get("sandbox", {}).get("view_only")

        if is_blocked:
            cat_name = c.get("sandbox", {}).get("block_category", "")
            tags = f'<span class="badge red">{S("blocked_badge", lang, cat=cat_name)}</span>'
        else:
            reqs = c.get("requirements", {})
            tag_parts = []
            for cat in CATEGORIES:
                items = reqs.get(cat, [])
                if items:
                    cfg = CATEGORY_CONFIG[cat]
                    for item in items:
                        label = _item_label(cat, item)
                        tag_parts.append(f'<span class="req-tag {cfg["css_tag"]}">{cfg["icon"]} {_esc(label)}</span>')
            tags = " ".join(tag_parts) if tag_parts else f'<span class="badge gray">{S("no_reqs", lang)}</span>'

        h.append(f'<tr><td>{i}</td><td class="case-id">{_esc(cid)}</td><td>{_esc(title_text)}</td><td>{tags}</td></tr>\n')

    h.append('</table>\n')

    # Footer
    h.append(html_foot(lang, date, meta.get("input_file", ""), stats["total"], "Prerequisite Gap Analysis"))
    return "".join(h)


def _item_label(cat: str, item: dict) -> str:
    """Short label for a requirement item (for per-case tags)."""
    if cat == "apps":
        return item.get("name", "App")
    elif cat == "accounts":
        return item.get("type", "Account")
    elif cat == "files":
        qty = item.get("quantity", "1")
        return f'{item.get("type", "file")} ×{qty}'
    elif cat == "urls":
        return item.get("url", item.get("type", "URL"))[:40]
    elif cat == "environment":
        return item.get("type", "env")
    elif cat == "hardware":
        return item.get("type", "hw")
    elif cat == "preconfig":
        return item.get("data_type", "data")
    return str(item)


def _category_table(cat: str, rows: list, lang: str) -> str:
    """Render the summary table for one requirement category."""
    h = ['<table class="req-table">\n<tr>']

    # Column definitions per category
    col_defs = {
        "apps": [("col_app_name", "name"), ("col_purpose", "purpose"), ("col_state", "state"), ("col_ref_cases", "case_ids")],
        "accounts": [("col_acct_type", "type"), ("col_sign_in", "method"), ("col_special", "special"), ("col_ref_cases", "case_ids")],
        "files": [("col_file_type", "type"), ("col_quantity", "quantity"), ("col_size", "size"), ("col_properties", "properties"), ("col_location", "location"), ("col_ref_cases", "case_ids")],
        "urls": [("col_url", "url"), ("col_purpose", "purpose"), ("col_ref_cases", "case_ids")],
        "environment": [("col_env_type", "type"), ("col_env_value", "value"), ("col_ref_cases", "case_ids")],
        "hardware": [("col_hw_type", "type"), ("col_detail", "value"), ("col_ref_cases", "case_ids")],
        "preconfig": [("col_data_type", "data_type"), ("col_quantity", "quantity"), ("col_detail", "detail"), ("col_ref_cases", "case_ids")],
    }

    cols = col_defs.get(cat, [("col_detail", "key"), ("col_ref_cases", "case_ids")])

    for col_key, _ in cols:
        h.append(f'<th>{S(col_key, lang)}</th>')
    h.append('</tr>\n')

    for row in rows:
        h.append('<tr>')
        for _, field in cols:
            val = row.get(field, "")
            if field == "case_ids":
                val = ", ".join(val) if isinstance(val, list) else str(val)
            h.append(f'<td>{_esc(val)}</td>')
        h.append('</tr>\n')

    h.append('</table>\n')
    return "".join(h)


def _render_tsv(path: Path, cases: list, summary: dict):
    """Write TSV with per-case requirements."""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["Case ID", "Title", "Blocked", "Apps", "Accounts", "Files", "URLs", "Environment", "Hardware", "Preconfig"])
        for c in cases:
            cid = c.get("case_id", "")
            title = c.get("title", "")
            blocked = "Yes" if c.get("sandbox", {}).get("blocked") else ""
            reqs = c.get("requirements", {})
            row = [cid, title, blocked]
            for cat in CATEGORIES:
                items = reqs.get(cat, [])
                row.append("; ".join(_item_label(cat, it) for it in items) if items else "")
            writer.writerow(row)
