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
Pre-Rewrite Quality Check report renderer.
Reads analysis.jsonl (quality field) → produces bilingual HTML + TSV.

No LLM needed — all logic is deterministic.
"""
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from ..shared.i18n import S
from ..shared.html_engine import CSS, html_head, html_foot, summary_card, _esc
from ..shared.loader import load_analysis

# ═══════════════════════════════════════════════════════════════
#  Quality check items
# ═══════════════════════════════════════════════════════════════

GROUP_A_ITEMS = ["A1_id", "A2_preconditions", "A3_steps", "A4_expected_result", "A5_app_platform"]
GROUP_B_ITEMS = ["B1_grounding", "B2_autonomy", "B3_granularity", "B4_reliability"]


def _compute_decision(quality: dict) -> str:
    """Compute quality decision from group_a and group_b results."""
    ga = quality.get("group_a", {})
    gb = quality.get("group_b", {})

    # Group A: any fail → blocked
    a_pass = all(ga.get(item, True) for item in GROUP_A_ITEMS)
    if not a_pass:
        return "blocked"

    # Group B: any fail → rewrite_recommended
    b_pass = all(
        (gb.get(item, {}).get("pass", True) if isinstance(gb.get(item), dict) else gb.get(item, True))
        for item in GROUP_B_ITEMS
    )
    if not b_pass:
        return "rewrite_recommended"

    return "ready"


# ═══════════════════════════════════════════════════════════════
#  HTML generation
# ═══════════════════════════════════════════════════════════════

def render(analysis_path: Path, output_dir: Path, *, langs: tuple[str, ...] = ("en",)):
    """Main entry: render quality analysis report + TSV."""
    data = load_analysis(analysis_path)
    meta = data["meta"]
    cases = data["cases"]

    # Compute decisions
    for c in cases:
        q = c.get("quality", {})
        if "decision" not in q:
            q["decision"] = _compute_decision(q)
            c["quality"] = q

    prefix = Path(meta.get("input_file", "analysis")).stem
    date = meta.get("generated_at", datetime.now().strftime("%Y-%m-%d"))
    app = meta.get("app", "")
    platform = meta.get("platform", "")

    for lang in langs:
        html = _render_html(lang, meta, cases, date, prefix, app, platform)
        suffix = "en" if lang == "en" else "cn"
        out_path = output_dir / f"{prefix}_quality_analysis_{suffix}.html"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote: {out_path}")

    tsv_path = output_dir / f"{prefix}_quality_analysis.tsv"
    _render_tsv(tsv_path, cases)
    print(f"Wrote: {tsv_path}")


def _render_html(lang, meta, cases, date, prefix, app, platform):
    h = []
    title = f"{app} {platform} — {S('quality_title', lang)}"
    h.append(html_head(title, lang))

    n_cases = len(cases)
    file_name = meta.get("input_file", "")

    # Count decisions
    ready = sum(1 for c in cases if c.get("quality", {}).get("decision") == "ready")
    rewrite = sum(1 for c in cases if c.get("quality", {}).get("decision") == "rewrite_recommended")
    blocked = sum(1 for c in cases if c.get("quality", {}).get("decision") == "blocked")

    h.append(f'<h1>{_esc(title)}</h1>\n')
    h.append(f'<p class="subtitle">{S("quality_subtitle_tpl", lang, n_cases=n_cases, date=date, file=file_name)}</p>\n')

    # ── Section 1: Summary Cards ──
    h.append('<div class="summary-bar">\n')
    h.append(summary_card(S("total", lang), n_cases, f'{n_cases} {S("q_cases", lang)}', "total"))
    h.append(summary_card(S("q_ready", lang), ready, f'{ready} {S("q_cases", lang)}', "green"))
    h.append(summary_card(S("q_rewrite_rec", lang), rewrite, f'{rewrite} {S("q_cases", lang)}', "orange"))
    h.append(summary_card(S("q_blocked", lang), blocked, f'{blocked} {S("q_cases", lang)}', "red"))
    h.append('</div>\n')

    # ── Section 2: Issues Overview ──
    h.append(f'<h2>{S("q_issues_overview", lang)}</h2>\n')

    # Count failures per check item
    a_fails = defaultdict(int)
    b_fails = defaultdict(list)
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
        h.append(f'<div class="cat-header cat-hw">{S("q_group_a", lang)} — {S("q_structural", lang)}</div>\n')
        h.append(f'<table class="req-table"><tr><th>{S("q_check_item", lang)}</th><th>{S("q_fail_count", lang)}</th><th>{S("col_ref_cases", lang)}</th></tr>\n')
        for item in GROUP_A_ITEMS:
            if item in a_fails:
                h.append(f'<tr><td>{S("q_" + item, lang)}</td><td><span class="badge red">{a_fails[item]}</span></td><td>—</td></tr>\n')
        h.append('</table>\n')

    # Group B table
    if b_fails:
        h.append(f'<div class="cat-header cat-env">{S("q_group_b", lang)} — {S("q_description", lang)}</div>\n')
        h.append(f'<table class="req-table"><tr><th>{S("q_check_item", lang)}</th><th>{S("q_fail_count", lang)}</th><th>{S("col_ref_cases", lang)}</th></tr>\n')
        for item in GROUP_B_ITEMS:
            if item in b_fails:
                case_ids = ", ".join(b_fails[item][:5])
                if len(b_fails[item]) > 5:
                    case_ids += f" +{len(b_fails[item]) - 5}"
                h.append(f'<tr><td>{S("q_" + item, lang)}</td><td><span class="badge orange">{len(b_fails[item])}</span></td><td class="case-id">{_esc(case_ids)}</td></tr>\n')
        h.append('</table>\n')

    if not a_fails and not b_fails:
        h.append(f'<p style="color:var(--green);font-weight:600">{S("q_no_issues", lang)}</p>\n')

    # ── Section 3: Per-Case Detail Table ──
    h.append(f'<h2>{S("q_per_case", lang)}</h2>\n')

    # Decision groups
    decision_order = [("blocked", "red"), ("rewrite_recommended", "orange"), ("ready", "green")]
    for decision, css_color in decision_order:
        group_cases = [c for c in cases if c.get("quality", {}).get("decision") == decision]
        if not group_cases:
            continue

        decision_label = S(f"q_decision_{decision}", lang)
        h.append(f'<div class="group-divider {css_color}" style="background:var(--{css_color}-bg,#f8f9fa);border-left:5px solid var(--{css_color},#6c757d)">{decision_label} ({len(group_cases)})</div>\n')

        h.append(f'<table class="case-table"><tr><th>#</th><th>{S("col_case_id", lang)}</th><th>{S("col_title", lang)}</th>')
        h.append(f'<th>{S("q_group_a", lang)}</th><th>{S("q_group_b", lang)}</th><th>{S("q_issues", lang)}</th></tr>\n')

        for i, c in enumerate(group_cases, 1):
            q = c.get("quality", {})
            ga = q.get("group_a", {})
            gb = q.get("group_b", {})

            # Group A badge
            a_failed = [item for item in GROUP_A_ITEMS if not ga.get(item, True)]
            if a_failed:
                a_str = f'<span class="badge red">⛔ {len(a_failed)} fail</span>'
            else:
                a_str = '<span class="badge green">✅</span>'

            # Group B badge
            b_failed = []
            for item in GROUP_B_ITEMS:
                val = gb.get(item, {})
                passed = val.get("pass", True) if isinstance(val, dict) else val
                if not passed:
                    b_failed.append(item)
            if b_failed:
                b_str = f'<span class="badge orange">⚠️ {len(b_failed)} warn</span>'
            else:
                b_str = '<span class="badge green">✅</span>'

            # Issues detail
            issues = []
            for item in a_failed:
                issues.append(f'<span class="badge red">{S("q_" + item + "_short", lang)}</span>')
            for item in b_failed:
                val = gb.get(item, {})
                detail = val.get("detail", "") if isinstance(val, dict) else ""
                label = S("q_" + item + "_short", lang)
                if detail:
                    issues.append(f'<span class="badge orange">{label}</span> <span class="missing-reason">{_esc(detail)}</span>')
                else:
                    issues.append(f'<span class="badge orange">{label}</span>')
            issues_html = "<br>".join(issues) if issues else ""

            h.append(f'<tr><td>{i}</td><td class="case-id">{_esc(c.get("case_id", ""))}</td>')
            h.append(f'<td>{_esc(c["title"][:100])}</td><td>{a_str}</td><td>{b_str}</td>')
            h.append(f'<td>{issues_html}</td></tr>\n')
        h.append('</table>\n')

    # Footer
    h.append(html_foot(lang, date, meta.get("input_file", ""), n_cases, "Quality Analysis"))

    return "".join(h)


def _render_tsv(path: Path, cases: list):
    """Write TSV summary."""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["Case ID", "Title", "Decision", "A_Fails", "B_Fails", "B_Details"])
        for c in cases:
            q = c.get("quality", {})
            ga = q.get("group_a", {})
            gb = q.get("group_b", {})

            a_failed = [item for item in GROUP_A_ITEMS if not ga.get(item, True)]
            b_failed = []
            b_details = []
            for item in GROUP_B_ITEMS:
                val = gb.get(item, {})
                passed = val.get("pass", True) if isinstance(val, dict) else val
                if not passed:
                    b_failed.append(item)
                    detail = val.get("detail", "") if isinstance(val, dict) else ""
                    if detail:
                        b_details.append(f"{item}: {detail}")

            writer.writerow([
                c.get("case_id", ""),
                c.get("title", ""),
                q.get("decision", ""),
                ", ".join(a_failed) if a_failed else "",
                ", ".join(b_failed) if b_failed else "",
                "; ".join(b_details) if b_details else "",
            ])
