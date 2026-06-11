"""
Breakdown report renderer.
Reads analysis.jsonl + infra.json → produces bilingual HTML + TSV.

No LLM needed — all logic is deterministic.
"""
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from ..shared.i18n import S
from ..shared.html_engine import (
    CSS, html_head, html_foot, summary_card, _esc,
    CATEGORY_CONFIG,
)
from ..shared.loader import load_analysis, load_infra, group_cases_by_feature

import re

# ═══════════════════════════════════════════════════════════════
#  Title normalisation for coverage matching
# ═══════════════════════════════════════════════════════════════

_ID_PREFIX_RE = re.compile(r'^[A-Z]+-\d+:\s*')


def _norm_title(title: str) -> str:
    """Strip leading 'STCAQA-1234: ' style prefix and normalise whitespace."""
    t = _ID_PREFIX_RE.sub('', title)
    return ' '.join(t.split()).strip()


# ═══════════════════════════════════════════════════════════════
#  Decision tree — compute recommendation per feature
# ═══════════════════════════════════════════════════════════════

ACTION_ORDER = ["record", "quick_win", "review", "skip"]
ACTION_CSS = {"record": "record", "quick_win": "quick_win", "review": "review", "skip": "skip"}
REC_BOX_CSS = {"record": "record", "quick_win": "quick", "review": "review", "skip": "skip"}


def _compute_recommendation(feature: str, cases: list, infra_feat: dict | None) -> dict:
    """
    Decision tree for one feature.
    Returns dict with action_category, rec_code, rec_params, counts, etc.
    """
    total = len(cases)
    blocked = sum(
        1 for c in cases
        if c.get("sandbox", {}).get("blocked") and not c.get("sandbox", {}).get("view_only")
    )
    view_only_ids = {
        c["case_id"] for c in cases
        if c.get("sandbox", {}).get("view_only")
    }

    has_infra = infra_feat is not None
    has_doc = infra_feat.get("has_feature_doc", False) if has_infra else False
    has_rec = infra_feat.get("has_recorder", False) if has_infra else False
    has_rewritten = infra_feat.get("has_rewritten", False) if has_infra else False

    # Coverage: match case titles against rewritten titles (normalised)
    rewritten_norm = {
        _norm_title(t) for t in infra_feat.get("rewritten_titles", [])
    } if has_infra else set()
    covered = 0
    for c in cases:
        # Check explicit coverage status from LLM analysis first
        cov_status = c.get("coverage", {}).get("status", "")
        if cov_status == "covered":
            covered += 1
        elif _norm_title(c["title"]) in rewritten_norm:
            covered += 1
            c.setdefault("coverage", {})["status"] = "covered"
        elif cov_status == "doc_covered":
            covered += 1
    net_new = total - covered - blocked

    # Decision
    if blocked >= total:
        action = "skip"
        rec_code = "skip"
    elif not has_infra:
        action = "record"
        rec_code = "new"
    elif has_doc and not has_rec:
        action = "record"
        rec_code = "need_recording"
    elif net_new == 0 and covered > 0:
        action = "quick_win"
        rec_code = "covered"
    elif net_new > 0:
        action = "review"
        rec_code = "evaluate"
    else:
        action = "record"
        rec_code = "new"

    # VPN: aggregate from cases
    vpn_required = any(c.get("vpn", {}).get("required") for c in cases)
    vpn_reasons = {c["vpn"]["reason"] for c in cases if c.get("vpn", {}).get("required") and c["vpn"].get("reason")}

    return {
        "action_category": action,
        "rec_code": rec_code,
        "rec_params": {"n": net_new or total, "b": blocked, "t": total},
        "total": total,
        "blocked": blocked,
        "covered": covered,
        "net_new": net_new,
        "has_infra": has_infra,
        "has_doc": has_doc,
        "has_recorder": has_rec,
        "has_rewritten": has_rewritten,
        "vpn_required": vpn_required,
        "vpn_reasons": vpn_reasons,
        "view_only_ids": view_only_ids,
        "infra": infra_feat,
    }


# ═══════════════════════════════════════════════════════════════
#  HTML generation
# ═══════════════════════════════════════════════════════════════

def render(analysis_path: Path, infra_path: Path | None, output_dir: Path, *, langs: tuple[str, ...] = ("en",)):
    """Main entry: render executability analysis report + TSV."""
    data = load_analysis(analysis_path)
    infra = load_infra(infra_path)
    meta = data["meta"]
    cases = data["cases"]
    summaries = data["feature_summaries"]

    feature_groups = group_cases_by_feature(cases)

    # Compute recommendations
    recs = {}
    for feat, feat_cases in feature_groups.items():
        folder = feat_cases[0].get("folder", "")
        infra_feat = infra.get("features", {}).get(folder)
        recs[feat] = _compute_recommendation(feat, feat_cases, infra_feat)

    # Group features by action category
    by_action = defaultdict(list)
    for feat, rec in recs.items():
        by_action[rec["action_category"]].append((feat, rec))
    # Sort within each group by case count desc
    for action in by_action:
        by_action[action].sort(key=lambda x: -x[1]["total"])

    # Generate
    prefix = Path(meta.get("input_file", "analysis")).stem
    date = meta.get("generated_at", datetime.now().strftime("%Y-%m-%d"))
    app = meta.get("app", "")
    platform = meta.get("platform", "")

    for lang in langs:
        html = _render_html(
            lang, meta, feature_groups, recs, by_action, summaries, infra, date, prefix, app, platform
        )
        suffix = "en" if lang == "en" else "cn"
        out_path = output_dir / f"{prefix}_executability_analysis_{suffix}.html"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"Wrote: {out_path}")

    # TSV
    tsv_path = output_dir / f"{prefix}_executability_analysis.tsv"
    _render_tsv(tsv_path, feature_groups, recs)
    print(f"Wrote: {tsv_path}")


def _render_html(lang, meta, feature_groups, recs, by_action, summaries, infra, date, prefix, app, platform):
    h = []
    title = f"{app} {platform} — {S('breakdown_title', lang)}"
    h.append(html_head(title, lang))

    n_features = len(feature_groups)
    n_cases = sum(len(v) for v in feature_groups.values())
    file_name = meta.get("input_file", "")

    # Title + subtitle
    h.append(f'<h1>{_esc(title)}</h1>\n')
    h.append(f'<p class="subtitle">{S("breakdown_subtitle_tpl", lang, n_cases=n_cases, n_features=n_features, date=date, file=file_name)}</p>\n')

    # ── Section 1: Summary cards ──
    action_counts = {}
    for action in ACTION_ORDER:
        feats = by_action.get(action, [])
        f_count = len(feats)
        c_count = sum(r["total"] for _, r in feats)
        action_counts[action] = (f_count, c_count)

    # Count sandbox-blocked cases across ALL features (not just "skip" action)
    all_blocked_cases = sum(
        r["blocked"] for _, r in recs.items()
    )
    blocked_features = sum(
        1 for _, r in recs.items() if r["blocked"] > 0
    )

    h.append('<div class="summary-bar">\n')
    h.append(summary_card(S("total", lang), n_features, f'{n_features} {S("features_cases", lang, c=n_cases)}', "total"))
    card_map = [
        ("need_recording", "record", "blue"),
        ("quick_wins", "quick_win", "green"),
        ("review_needed", "review", "orange"),
    ]
    for label_key, action, css in card_map:
        fc, cc = action_counts.get(action, (0, 0))
        h.append(summary_card(S(label_key, lang), fc, f'{fc} {S("features_cases", lang, c=cc)}', css))
    # Sandbox blocked: show actual blocked case count across all features
    h.append(summary_card(
        S("sandbox_blocked", lang), all_blocked_cases,
        f'{blocked_features} {S("features_cases", lang, c=all_blocked_cases)}', "red"
    ))
    h.append('</div>\n')

    # ── Section 2: Action Summary ──
    h.append(f'<h2>{S("action_summary", lang)}</h2>\n')
    grp_keys = {"record": "grp_record", "quick_win": "grp_quick", "review": "grp_review", "skip": "grp_skip"}
    action_li_css = {"record": "record", "quick_win": "quick", "review": "review", "skip": "skip"}
    for action in ACTION_ORDER:
        feats = by_action.get(action, [])
        if not feats:
            continue
        fc = len(feats)
        cc = sum(r["total"] for _, r in feats)
        h.append(f'<div class="action-section">\n')
        h.append(f'<h3>{S(grp_keys[action], lang)} — {fc} features · {cc} cases</h3>\n')
        h.append('<ul class="action-list">\n')
        for feat, rec in feats:
            rec_text = S(f'rec_{rec["rec_code"]}', lang, **rec["rec_params"])
            li_css = action_li_css[action]
            vpn_html = ""
            if rec["vpn_required"]:
                vpn_html = f' <span class="badge" style="background:#e0e7ff;color:#3730a3">{S("vpn_badge", lang)}</span>'
                reasons = rec.get("vpn_reasons", set())
                if reasons:
                    reason_text = S(list(reasons)[0], lang)
                    vpn_html += f'<br><span style="font-size:0.78rem;color:var(--text2)">{reason_text}</span>'
            h.append(f'<li class="{li_css}"><b>{_esc(feat)}</b> ({rec["total"]} cases){vpn_html} — {rec_text}</li>\n')
        h.append('</ul>\n</div>\n')

    # ── Section 3: Platform Feasibility Summary ──
    sandbox_cases = [c for c in meta.get("_all_cases", []) or [] if c.get("sandbox", {}).get("blocked")]
    # Collect blocked categories from cases
    block_cats = defaultdict(int)
    for c in sum(feature_groups.values(), []):
        if c.get("sandbox", {}).get("blocked"):
            cat = c.get("sandbox", {}).get("block_category", "Unknown")
            block_cats[cat] += 1
    if block_cats:
        h.append(f'<h2>{S("platform_summary", lang)}</h2>\n')
        h.append(f'<table class="risk-table"><tr><th>{S("risk_category", lang)}</th><th>{S("risk_affected", lang)}</th></tr>\n')
        for cat, count in sorted(block_cats.items(), key=lambda x: -x[1]):
            h.append(f'<tr><td>{_esc(cat)}</td><td>{count}</td></tr>\n')
        h.append('</table>\n')

    # ── Section 4: Feature Overview Table ──
    h.append(f'<h2>{S("feat_overview", lang)}</h2>\n')
    h.append(f'<table class="overview-table"><tr>')
    for col in ["col_feature", "col_cases", "col_sandbox", "col_artifacts", "col_covered", "col_new", "col_recommendation"]:
        h.append(f'<th>{S(col, lang)}</th>')
    h.append('</tr>\n')

    for action in ACTION_ORDER:
        feats = by_action.get(action, [])
        if not feats:
            continue
        h.append(f'<tr><td colspan="7" class="group-header {ACTION_CSS[action]}">{S(grp_keys[action], lang)}</td></tr>\n')
        for feat, rec in feats:
            sandbox_str = f'⛔ {rec["blocked"]}' if rec["blocked"] > 0 else "✅"
            artifacts = []
            if rec["has_doc"]:
                artifacts.append('<span class="artifact yes">Doc</span>')
            if rec["has_recorder"]:
                artifacts.append('<span class="artifact yes">Rec</span>')
            if rec.get("has_rewritten"):
                artifacts.append('<span class="artifact yes">Rew</span>')
            if not artifacts:
                artifacts.append('<span class="artifact no">—</span>')
            rec_text = S(f'rec_{rec["rec_code"]}', lang, **rec["rec_params"])
            h.append(f'<tr><td><b>{_esc(feat)}</b></td><td>{rec["total"]}</td><td>{sandbox_str}</td>')
            h.append(f'<td>{"".join(artifacts)}</td><td>{rec["covered"]}</td><td>{rec["net_new"]}</td>')
            h.append(f'<td>{rec_text}</td></tr>\n')
    h.append('</table>\n')

    # ── Section 5: Feature Details ──
    h.append(f'<h2>{S("feat_details", lang)}</h2>\n')

    for action in ACTION_ORDER:
        feats = by_action.get(action, [])
        if not feats:
            continue
        h.append(f'<div class="group-divider {ACTION_CSS[action]}">{S(grp_keys[action], lang)}</div>\n')

        for feat, rec in feats:
            feat_cases = feature_groups[feat]
            h.append(f'<div class="feat-section">\n')
            h.append(f'<h3>{_esc(feat)} <span class="case-count">{rec["total"]}</span></h3>\n')

            # Infra box
            if rec["has_infra"]:
                infra_feat = rec["infra"] or {}
                css = "complete" if rec["has_doc"] and rec["has_recorder"] else "partial"
                h.append(f'<div class="infra-box {css}"><h4>{S("existing_infra", lang)}</h4><ul>\n')
                h.append(f'<li>Feature Doc: {"✅" if rec["has_doc"] else "❌"}</li>\n')
                h.append(f'<li>Recorder: {"✅" if rec["has_recorder"] else "❌"}</li>\n')
                if rec.get("has_rewritten"):
                    h.append(f'<li>Rewritten: {infra_feat.get("rewritten_count", 0)} cases</li>\n')
                h.append('</ul></div>\n')
            else:
                h.append(f'<div class="infra-box none"><h4>{S("no_infra", lang)}</h4></div>\n')

            # VPN box
            if rec["vpn_required"]:
                reasons = rec.get("vpn_reasons", set())
                reason_text = S(list(reasons)[0], lang) if reasons else ""
                h.append(f'<div class="vpn-box"><h4>{S("vpn_badge", lang)}</h4><p>{reason_text}</p></div>\n')

            # Sandbox box (if any blocked)
            if rec["blocked"] > 0:
                h.append(f'<div class="sandbox-box"><h4>{S("sandbox_blocked", lang)}</h4>')
                h.append(f'<p>{rec["blocked"]}/{rec["total"]} cases blocked</p></div>\n')

            # Collection hints (only for record features)
            if action == "record" and feat in summaries:
                summary = summaries[feat]
                hints = summary.get("collection_hints", {}).get(lang, summary.get("collection_hints", {}).get("en", {}))
                if hints:
                    h.append(f'<div class="collection-box"><h4>{S("collection_title", lang)}</h4>\n')
                    if hints.get("screenshots"):
                        h.append(f'<span class="sub-title">{S("screenshots_needed", lang)}</span><ul>\n')
                        for s in hints["screenshots"]:
                            h.append(f'<li>{_esc(s)}</li>\n')
                        h.append('</ul>\n')
                    if hints.get("info"):
                        h.append(f'<span class="sub-title">{S("info_needed", lang)}</span><ul>\n')
                        for s in hints["info"]:
                            h.append(f'<li>{_esc(s)}</li>\n')
                        h.append('</ul>\n')
                    h.append('</div>\n')

            # Case table — unified format for all action types
            h.append(f'<table class="case-table"><tr><th>#</th><th>{S("col_case_id", lang)}</th>')
            h.append(f'<th>{S("col_title", lang)}</th><th>{S("col_sandbox", lang)}</th>')
            h.append(f'<th>{S("col_covered", lang)}</th><th>{S("col_missing", lang)}</th></tr>\n')

            infra_feat_data = rec.get("infra") or {}
            rewritten_norm_set = {_norm_title(t) for t in infra_feat_data.get("rewritten_titles", [])}

            for i, c in enumerate(feat_cases, 1):
                # Sandbox badge
                sb = c.get("sandbox", {})
                if sb.get("blocked") and not sb.get("view_only"):
                    sandbox_str = '<span class="badge red">⛔</span>'
                elif sb.get("view_only"):
                    sandbox_str = f'<span class="badge" style="background:#e0e7ff;color:#3730a3">{S("view_only_badge", lang)}</span>'
                else:
                    sandbox_str = "✅"

                # Coverage status
                cov = c.get("coverage", {})
                cov_status = cov.get("status", "")
                if not cov_status:
                    # Fallback: title matching
                    if _norm_title(c["title"]) in rewritten_norm_set:
                        cov_status = "covered"
                    else:
                        cov_status = "unknown"

                if cov_status == "covered":
                    covered_str = f'<span class="badge green">{S("cov_covered", lang)}</span>'
                elif cov_status == "doc_covered":
                    covered_str = f'<span class="badge green">{S("cov_doc_covered", lang)}</span>'
                elif cov_status == "doc_partial":
                    covered_str = f'<span class="badge orange">{S("cov_doc_partial", lang)}</span>'
                elif cov_status == "doc_missing":
                    covered_str = f'<span class="badge red">{S("cov_doc_missing", lang)}</span>'
                elif cov_status == "no_infra":
                    covered_str = f'<span class="badge red">{S("cov_no_infra", lang)}</span>'
                else:
                    covered_str = '<span class="badge orange">NEW</span>'

                # Missing doc / coverage conclusion
                missing_html = ""
                # Show coverage conclusion if available
                cov_conclusion = cov.get("conclusion_cn" if lang == "cn" else "conclusion_en", "")
                if cov_conclusion:
                    missing_html = f'<span class="missing-reason">{_esc(cov_conclusion)}</span>'
                elif c.get("missing_doc"):
                    # Fall back to missing_doc full text
                    for mk in c["missing_doc"]:
                        missing_html += f'<span class="missing-reason">{S(mk, lang)}</span><br>'

                h.append(f'<tr><td>{i}</td><td class="case-id">{_esc(c.get("case_id", ""))}</td>')
                h.append(f'<td>{_esc(c["title"][:100])}</td><td>{sandbox_str}</td>')
                h.append(f'<td>{covered_str}</td><td>{missing_html}</td></tr>\n')
            h.append('</table>\n')

            # Recommendation box
            rec_css = REC_BOX_CSS.get(action, "record")
            rec_text = S(f'rec_{rec["rec_code"]}', lang, **rec["rec_params"])
            rec_detail = S(f'rec_{rec["rec_code"]}_detail', lang, **rec["rec_params"])
            if rec["rec_code"] == "new" and rec["rec_params"].get("b", 0) > 0:
                rec_detail += S("rec_new_detail_blocked", lang, **rec["rec_params"])
            h.append(f'<div class="rec-box {rec_css}"><h4>{rec_text}</h4><p>{rec_detail}</p></div>\n')

            h.append('</div>\n')  # feat-section

    # Footer
    h.append(html_foot(lang, date, meta.get("input_file", ""), sum(len(v) for v in feature_groups.values()), "Executability Analysis"))

    return "".join(h)


def _render_tsv(path: Path, feature_groups, recs):
    """Write TSV summary."""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(["Feature", "Cases", "Action", "Recommendation", "Blocked", "Covered", "New", "VPN"])
        for feat in sorted(recs.keys()):
            rec = recs[feat]
            writer.writerow([
                feat,
                rec["total"],
                rec["action_category"],
                rec["rec_code"],
                rec["blocked"],
                rec["covered"],
                rec["net_new"],
                "Yes" if rec["vpn_required"] else "",
            ])
