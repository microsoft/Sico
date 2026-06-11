# Breakdown Report — Renderer Details

> This file documents the breakdown report's decision tree, HTML structure, and CSS classes.
> Referenced from the main [SKILL.md](../SKILL.md). The renderer code lives in `report/breakdown/renderer.py`.

---

## Decision Tree

The renderer computes `action_category` and `rec_code` per feature using this fixed logic:

```
Input per feature:
  cases[]           — from analysis.jsonl
  infra             — from infra.json (matched by folder)
  sandbox_blocked   — count of cases where sandbox.blocked=true AND view_only=false
  total             — total cases in feature
  covered           — cases with coverage.status "covered" or "doc_covered"
  net_new           — total - covered - sandbox_blocked

Decision:
  if sandbox_blocked == total:
      action_category = "skip", rec_code = "skip"
  elif not infra.exists:
      action_category = "record", rec_code = "new"
  elif infra.has_feature_doc and not infra.has_recorder:
      action_category = "record", rec_code = "need_recording"
  elif net_new == 0:
      action_category = "quick_win", rec_code = "covered"
  elif net_new > 0:
      action_category = "review", rec_code = "evaluate"
```

**Coverage counting**: `covered` includes cases with `coverage.status` of `"covered"` (title-matched) or `"doc_covered"` (Feature Doc covers it). Title matching normalises by stripping `ID: ` prefixes and whitespace.

---

## HTML Structure

5 sections in this exact order:

1. **Summary Cards** — 5 cards: Total, 🎥 Need Recording, ✅ Quick Wins, 🔍 Review Needed, ⛔ Sandbox Blocked. The Sandbox card shows **total blocked cases across all features** (not just features where all cases are blocked).
2. **Action Summary** — grouped feature lists with recommendations, VPN badges where applicable
3. **Platform Feasibility Summary** — table of sandbox limitation categories with risk levels
4. **Feature Overview Table** — all features grouped by action_category with colored headers
5. **Feature Details** — per-feature detail cards with **unified case table format** (all action types):
   - Infra box → collection hints (for record features) → case table → recommendation box
   - Case table columns: `# | Case ID | Title | Sandbox | Coverage | Analysis`
   - Coverage column shows status badge: ✅ Covered / ✅ Doc Covers / ⚠️ Partial / ❌ Not Covered / ❌ No Infra
   - Analysis column shows `coverage.conclusion` (bilingual, from LLM analysis) or falls back to `missing_doc` full text

---

## Recommendation Keys

| Key | English | Chinese |
|-----|---------|---------|
| `rec_skip` | ⛔ Skip — all cases blocked by sandbox | ⛔ 跳过 — 所有用例被沙箱限制阻塞 |
| `rec_new` | 🆕 New feature — needs full recording pipeline | 🆕 新 Feature — 需要完整录制流水线 |
| `rec_need_recording` | 🎥 Has Feature Doc but needs recording | 🎥 有 Feature Doc 但需要录制 |
| `rec_covered` | ✅ Fully covered — no action needed | ✅ 完全覆盖 — 无需操作 |
| `rec_evaluate` | 📝 Has infra but {n} new case(s) | 📝 有基础设施但 {n} 条新增用例 |

---

## Breakdown-specific CSS classes

| Element | CSS | Color |
|---------|-----|-------|
| Record group | `.group-header.record` | Blue `#e7f1ff` |
| Quick win group | `.group-header.quick_win` | Green `#d1e7dd` |
| Review group | `.group-header.review` | Orange `#fff3cd` |
| Skip group | `.group-header.skip` | Red `#f8d7da` |
| Collection hints | `.collection-box` | Green `#e8f5e9` |
| Sandbox warning | `.sandbox-box` | Red `#f8d7da` |
| VPN box | `.vpn-box` | Indigo `#e0e7ff` |
