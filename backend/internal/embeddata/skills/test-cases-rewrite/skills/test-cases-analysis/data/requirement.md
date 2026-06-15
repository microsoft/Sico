# Requirement Report — Renderer Details

> This file documents the requirement report's HTML structure, aggregation rules, and CSS classes.
> Referenced from the main [SKILL.md](../SKILL.md). The renderer code lives in `report/requirement/renderer.py`.
> Reference HTML template: [`requirement-template.html`](requirement-template.html).

---

## HTML Structure

3 sections in this exact order:

1. **Summary Cards** — Total Cases, Cases w/ Requirements, ⛔ Platform Blocked (if any), then one card per non-empty category. Each card shows: label, count value, sub text (e.g., "unique apps · 12 cases").
2. **Requirements Summary** — For each non-empty category: colored `cat-header` + category-specific summary table with de-duplicated, aggregated rows. Rows sorted by referenced case count (most-referenced first).
3. **Per-Case Requirement Details** — Every case in a table. Requirement column shows colored `req-tag` badges per category item. Blocked cases show red `⛔ Platform Blocked: <category>` badge. Cases without requirements show gray "No external requirements detected" badge.

---

## Aggregation Rules

1. **Apps**: Group by app name. Merge purposes and states across cases.
2. **Accounts**: Group by account type. Merge methods, credentials, and specials.
3. **Files**: Group by `(base_type, location)`. Take `max()` of quantities. Union size constraints and properties.
4. **URLs**: Group by URL or type. Merge purposes.
5. **Environment / Hardware**: Group by type. Merge values/details.
6. **Pre-config**: Group by data_type. Take `max()` of quantities. Union details.

**Blocked cases**: Excluded from aggregation. They don't contribute to actionable preparation.

---

## Category-Specific Table Columns

| Category | Columns |
|----------|---------|
| 📱 Apps | App Name · Purpose · Required State · Referenced Cases |
| 🔐 Accounts | Account Type · Sign-in Method · Credential · Special Requirements · Referenced Cases |
| 📁 Files | File Type · Quantity · Size · Properties · Location · Referenced Cases |
| 🔗 URLs | URL / Link Type · Purpose · Referenced Cases |
| 🌐 Environment | Type · Value / Setting · Referenced Cases |
| 📲 Hardware | Hardware · Detail · Referenced Cases |
| 📋 Pre-config | Data Type · Quantity · Details · Referenced Cases |

---

## Requirement-specific CSS classes

| Element | CSS Class | Color |
|---------|-----------|-------|
| Apps header | `.cat-header.cat-apps` | Blue `#cfe2ff` |
| Accounts header | `.cat-header.cat-accts` | Purple `#e8daef` |
| Files header | `.cat-header.cat-files` | Green `#d1e7dd` |
| URLs header | `.cat-header.cat-urls` | Cyan `#cff4fc` |
| Environment header | `.cat-header.cat-env` | Orange `#fff3cd` |
| Hardware header | `.cat-header.cat-hw` | Red `#f8d7da` |
| Pre-config header | `.cat-header.cat-preconf` | Gray `#e9ecef` |
| Per-case req tag | `.req-tag.apps` / `.req-tag.accounts` / etc. | Matches category color |
| No requirements | `.badge.gray` | Gray `#e9ecef` |
| Platform blocked | `.badge.red` | Red `#f8d7da` |

---

## Aggregation Rules

- **Apps**: group by `name`, union `purpose` and `case_ids`
- **Accounts**: group by `type`, union `special` and `case_ids`
- **Files**: group by `(type, location)`, quantities → `max()`, properties → `union()`
- **URLs**: group by `url` or `type`, union `purpose` and `case_ids`
- **Environment/Hardware/Preconfig**: group by `type`, union details and `case_ids`
- Sort each category by number of referenced cases (descending)

---

## Requirement-specific CSS classes

| Element | CSS | Color |
|---------|-----|-------|
| Apps category | `.cat-apps` | Blue `#cfe2ff` |
| Accounts category | `.cat-accts` | Purple `#e8daef` |
| Files category | `.cat-files` | Green `#d1e7dd` |
| URLs category | `.cat-urls` | Cyan `#cff4fc` |
| Environment category | `.cat-env` | Orange `#fff3cd` |
| Hardware category | `.cat-hw` | Red `#f8d7da` |
| Preconfig category | `.cat-preconf` | Gray `#e9ecef` |
