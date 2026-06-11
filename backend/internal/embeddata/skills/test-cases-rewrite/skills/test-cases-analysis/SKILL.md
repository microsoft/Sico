---
name: test-cases-analysis
description: "Analyze a batch of test cases to produce structured intermediate data (JSONL), then render a unified HTML dashboard report. The unified report classifies each case into Ready / Blocked by Sandbox / Prerequisite Needed / Low Quality tabs. Specialized reports (executability, prerequisite, quality) are available on explicit request. Use when: receiving new test cases for any app, assessing rewrite readiness, building preparation checklists, or evaluating sandbox feasibility."
argument-hint: "Provide the path to a test case file (TSV/CSV with a Title column), the app name & platform, and optionally the rewrite data folder and sandbox limitations file."
---

# Skill: Test Cases Analysis

> Analyze incoming test cases, produce a **structured intermediate document** (JSONL), then render a **unified HTML dashboard** that classifies each case into four tabs: Ready to Execute / Blocked by Sandbox / Prerequisite Needed / Low Quality. Specialized single-dimension reports (executability, prerequisite, quality) are also available but only generated when the user explicitly requests them.

**Output defaults**: By default, render **only the unified report** (`--type unified`). Do NOT render executability, prerequisite, or quality reports unless the user explicitly asks for them. Generate English-only (`--lang en`) unless the user explicitly requests Chinese or bilingual output (`--lang both`). When presenting results to the user, deliver only the **single unified HTML report link** and a short summary — do not paste intermediate JSONL or raw analysis data into the conversation.

## Architecture

```
Stage 1 (fixed code)     Stage 2 (LLM)              Stage 3 (fixed code)
─────────────────────    ───────────────────────     ──────────────────────
scan_infra.py            LLM reads:                  render command
  reads rewrite_root       · CSV (test cases)          reads analysis.jsonl
  → infra.json             · infra.json                + infra.json
                           · sandbox_limitations.md    → aggregation
                         analyzes each case:           → decision tree
                           · feature classification    → HTML (en + cn)
                           · sandbox / VPN             → TSV
                           · missing doc info
                           · external requirements
                         summarizes per-feature:
                           · collection hints
                         → analysis.jsonl
```

**Key principle**: LLM handles semantic understanding (classify features, judge sandbox feasibility, extract requirements, write collection hints). Fixed code handles deterministic operations (scan directories, run decision trees, aggregate statistics, render HTML).

---

## Inputs

| Input | Required | Used by | Description |
|-------|----------|---------|-------------|
| **Test case file** | Yes | LLM | TSV/CSV with `Title` column (and optionally `Steps`, `Description`). |
| **App name & platform** | Yes | LLM + renderer | E.g., "Copilot Android". |
| **Rewrite data folder** | For executability analysis | scan_infra | Root folder of existing rewrite infrastructure (e.g., `data/copilot_collect_rewrite/`). |
| **Sandbox limitations file** | Recommended | LLM | Markdown describing platform limitations (e.g., `sandbox_limitations.md`). |
| **App Intro document** | Optional | LLM | Markdown with app info, test credentials, download URLs. Enriches requirement extraction. |

### Rewrite data folder structure (for scan_infra)

```
<rewrite_root>/
├── common/                          # Shared assets (skipped)
├── 0408/, 0412/, ...                # Date-prefixed folders (skipped)
├── <Feature_Folder>/
│   ├── original_test_cases.tsv
│   └── <Feature_Folder>/
│       ├── Recorder/                # *.mp4, input_log_*.txt
│       ├── Parser/                  # *_trace.json, screenshots/
│       └── Rewriter/               # Feature_Doc.jsonl, config.yaml, rewritten_*.csv
```

---

## Output

| Output | Description |
|--------|-------------|
| `analysis.jsonl` | Structured intermediate document (LLM produces this) |
| `*_executability_analysis_en.html` + `*_executability_analysis_cn.html` | Executability Analysis report (if `--type executability` or `both`) |
| `*_prerequisite_gap_analysis_en.html` + `*_prerequisite_gap_analysis_cn.html` | Prerequisite Gap Analysis report (if `--type prerequisite` or `both`) |
| `*.tsv` | Machine-readable TSV per report type |

---

## Stage 1: Scan Infrastructure (Fixed Code)

Run before LLM analysis to produce `infra.json`:

```bash
python -m report.scan_infra --root <rewrite_root> --output <output_dir>/infra.json
```

### infra.json schema

```json
{
  "scan_root": "data/copilot_collect_rewrite/",
  "scanned_at": "2026-05-17T10:00:00",
  "features": {
    "Auth_And_Account": {
      "folder": "Auth_And_Account",
      "has_original_tsv": true,
      "original_case_titles": ["[Auth][Account] Can sign in MSA...", ...],
      "has_recorder": true,
      "has_parser": true,
      "has_feature_doc": true,
      "feature_doc_excerpt": "Auth & Account feature handles sign-in...",
      "feature_doc_functions": ["MSA sign-in", "Google sign-in", "Pro sign-in"],
      "has_rewritten": true,
      "rewritten_count": 12,
      "rewritten_titles": ["Sign in with MSA account...", ...]
    },
    "Composer_V4": { ... },
    ...
  }
}
```

**Scan rules**:
- Skip `common/`, date-prefixed folders (`0408/`, `0412/`, etc.), `_*` prefixed, non-directories
- For each feature folder, check nested `<folder>/<folder>/Recorder/`, `Parser/`, `Rewriter/`
- **Recorder detection** (multiple locations checked):
  - `<inner>/Recorder/` — standard location
  - `<inner>/Recorder_original/` — alternate naming convention
  - `<inner>/Parser/Session_*/Recorder/` — session-based structure
  - Detected if any `*.mp4` or `input_log_*.txt` files exist
- **Parser detection** (multiple locations checked):
  - `<inner>/Parser/*_trace.json` — standard location
  - `<inner>/Parser/Session_*/Parser/*_trace.json` — session-based structure
- Extract Feature Doc excerpt (first 200 chars of `description` field) and function list
- Extract rewritten case titles from `rewritten_*.csv` for coverage matching

---

## Stage 2: LLM Analysis → analysis.jsonl

The LLM reads the CSV, infra.json, and sandbox limitations, then produces a JSONL file with three record types.

### Record Type 1: `meta`

First line of the JSONL. One per file.

```json
{
  "type": "meta",
  "app": "Copilot",
  "platform": "Android",
  "generated_at": "2026-05-17",
  "input_file": "smoke_test_53.csv",
  "total_cases": 53,
  "sandbox_file": "sandbox_limitations.md",
  "infra_file": "infra.json"
}
```

### Record Type 2: `case`

One per test case. LLM fills all fields by understanding the Title (and Steps if available).

```json
{
  "type": "case",
  "case_id": "STCAQA-817",
  "title": "[Composer V4][Create mode][9] Tap \"+\" menu, verify all 9 buttons work...",
  "feature": "Composer V4",
  "folder": "Composer_V4",
  "test_point": "Tap + menu, verify 9 Create mode buttons work as expected",
  "sandbox": {
    "blocked": false,
    "view_only": false,
    "block_category": null
  },
  "vpn": {
    "required": false,
    "reason": null
  },
  "missing_doc": ["miss_p01", "miss_p02", "miss_p03"],
  "coverage": {
    "status": "covered",
    "matched_title": "STCAQA-817: [Composer V4][Create mode][9] ...",
    "doc_functions": [],
    "conclusion_en": "Matched existing rewritten case",
    "conclusion_cn": "已匹配已有改写用例"
  },
  "quality": {
    "group_a": {
      "A1_id": true,
      "A2_preconditions": true,
      "A3_steps": true,
      "A4_expected_result": false,
      "A5_app_platform": true
    },
    "group_b": {
      "B1_grounding": {"pass": false, "detail": "Uses abstract 'verify it works correctly'"},
      "B2_autonomy": {"pass": true, "detail": ""},
      "B3_granularity": {"pass": false, "detail": "Compound: 'verify all 9 buttons work as expected'"},
      "B4_reliability": {"pass": true, "detail": ""}
    },
    "decision": "rewrite_recommended"
  },
  "requirements": {
    "apps": [],
    "accounts": [
      {"type": "MSA", "method": "email+password", "credential": "Mobileaitest01@outlook.com / asdASD1!", "special": ""}
    ],
    "files": [],
    "urls": [],
    "environment": [],
    "hardware": [],
    "preconfig": []
  }
}
```

#### Quality Field (`quality`)

The LLM evaluates each case against the Pre-Rewrite Quality Standard. See [`data/quality-check-pre-rewrite.md`](data/quality-check-pre-rewrite.md) for full criteria.

**Group A (structural)** — boolean pass/fail per item:
- `A1_id`: Has unique identifier
- `A2_preconditions`: Preconditions explicitly stated
- `A3_steps`: Contains executable steps (not just a summary sentence)
- `A4_expected_result`: Has observable, verifiable expected results
- `A5_app_platform`: Target app and platform stated

**Group B (description quality)** — pass/fail + detail string:
- `B1_grounding`: References visible UI elements, not abstract wording
- `B2_autonomy`: Starts from clean state, no implicit assumptions
- `B3_granularity`: Each step is one atomic action
- `B4_reliability`: Deterministic, no randomness

**Decision** (computed from A/B results):
- `ready` — all pass
- `rewrite_recommended` — Group A passes, Group B has warnings
- `blocked` — Group A fails

#### Coverage Field (`coverage`)

The LLM determines each case's coverage status by checking:
1. **Title match**: Does the case title (ignoring `ID: ` prefix) match any rewritten title in infra.json?
2. **Feature Doc match**: If not title-matched, do the Feature Doc's documented functions cover the case's test point?

| Status | Meaning | When to use |
|--------|---------|-------------|
| `covered` | Case matches an existing rewritten test case | Title matches a rewritten_title in infra.json (after stripping ID prefix) |
| `doc_covered` | Feature Doc has sufficient info to rewrite this case | Feature Doc functions cover the test point; no recording needed |
| `doc_partial` | Feature Doc partially covers; some info missing | Feature Doc has related functions but lacks specific UI details or flows |
| `doc_missing` | Feature Doc does not cover this case | No relevant functions found; needs new recording |
| `no_infra` | Feature has no infrastructure at all | No infra.json entry for this feature |

**`conclusion_en` / `conclusion_cn`**: Brief bilingual explanation for the recording team. Examples:
- `"Matched existing rewritten case"` / `"已匹配已有改写用例"`
- `"Feature Doc has 'cold_start_landing' function covering this flow"` / `"Feature Doc 的 'cold_start_landing' 功能可覆盖此流程"`
- `"Feature Doc lacks image editing page layout info"` / `"Feature Doc 缺少图片编辑页面布局信息"`

### Record Type 3: `feature_summary`

One per feature that needs recording (action_category would be `"record"`). LLM writes this **after** processing all cases for a feature, by reviewing the full set of cases in that feature.

```json
{
  "type": "feature_summary",
  "feature": "Composer V4",
  "collection_hints": {
    "en": {
      "screenshots": [
        "Create menu showing all 9 buttons with icons",
        "Camera preview after tapping Camera button",
        "Photo gallery picker after tapping Photos",
        "File browser after tapping Files",
        "Image generation prompt UI",
        "Draft editor interface",
        "Deep research input screen",
        "Podcast creation UI",
        "Quiz setup screen",
        "Connectors selection list"
      ],
      "info": [
        "Each button's functional outcome (what UI appears after tap)",
        "Navigation path: Home → Composer → + button → Create menu",
        "Whether buttons open in-app screens or system pickers",
        "Back navigation behavior from each sub-feature"
      ]
    },
    "cn": {
      "screenshots": [
        "Create 菜单显示全部 9 个按钮及图标",
        "点击 Camera 后的相机预览界面",
        "点击 Photos 后的图库选择器",
        "点击 Files 后的文件浏览器",
        "图片生成提示界面",
        "草稿编辑界面",
        "深度研究输入界面",
        "播客创建界面",
        "测验设置界面",
        "连接器选择列表"
      ],
      "info": [
        "每个按钮点击后的功能产物（出现什么界面）",
        "导航路径：首页 → Composer → + 按钮 → Create 菜单",
        "按钮打开的是应用内界面还是系统选择器",
        "从每个子功能返回的导航行为"
      ]
    }
  },
  "notes": {
    "en": "9 buttons share the same entry point (+) but diverge into different functional UIs",
    "cn": "9 个按钮共享同一入口(+)，但进入不同的功能界面"
  }
}
```

---

## Stage 2 Analysis Guide

This section tells the LLM **how** to fill each field in the `case` record. These guidelines are distilled from proven project experience.

### Feature Classification (`feature`, `folder`)

Read the Title and assign a feature name. Guidelines:
- Extract `[Tag]` patterns from the title (e.g., `[Auth][Account]` → "Auth & Account")
- Use the **most specific** tag when multiple are present (`[Composer V4][Create mode]` → "Composer V4", not "Composer")
- If no `[Tag]` patterns exist, infer from keywords in the title
- For `folder`: look up `infra.json`'s feature list and find the best-matching folder name. If no match, generate one using the convention `Words_Joined_By_Underscores`

### Sandbox Assessment (`sandbox`)

Read the sandbox limitations file. For each case:
1. Check if the Title mentions any capability the sandbox cannot support (camera, voice, microphone, GPS, NFC, fingerprint, screen sharing, cross-device, etc.)
2. If it does, check if the case is **view-only** — i.e., it only verifies that a UI **appears/shows/displays** without requiring actual hardware interaction
3. Decision:

| Condition | Result |
|-----------|--------|
| Title mentions blocked capability AND requires actual interaction | `blocked: true, view_only: false` |
| Title mentions blocked capability BUT only verifies UI presence | `blocked: false, view_only: true` |
| Title does not mention any blocked capability | `blocked: false, view_only: false` |

**View-only signals**: "verify...show", "will show", "should display", "check...appear", "UI presence"

**Example**: `"[Voice] Verify new chat→open voice, will show voice unified UI"` → mentions "voice" (blocked) but only checks if UI "shows" → `view_only: true`

### VPN Assessment (`vpn`)

Check if the Title mentions region/market-specific behavior:
- Keywords: `region`, `market`, `locale`, `country`, `Japan`, `France`, `Canada`, `EU`, `US`, `geo`, `VPN`, `consent` (region-specific)
- If found: `required: true`, with reason being one of:
  - `"vpn_reason_market"` — feature behavior varies by market
  - `"vpn_reason_region"` — feature is geo-restricted
  - `"vpn_reason_other"` — other VPN needs

### Missing Doc Info (`missing_doc`)

Analyze what Feature Doc information would be needed to rewrite this case, and note what's likely missing for a new feature. Use these standard keys:

| Key | Meaning | When to add |
|-----|---------|-------------|
| `miss_p01` | Unknown page element layout (button/icon positions) | Title mentions verifying, checking, or interacting with specific UI elements |
| `miss_p02` | Unknown app initial state and navigation path | Almost always for new features — we don't know how to reach this feature |
| `miss_p03` | Verification criteria unclear | Title says "work as expected" / "successfully" without specifying what success looks like |
| `miss_p04` | Auth flow page sequence unknown | Title mentions sign-in, login, account, authentication |
| `miss_p11` | Test account credentials missing | Title mentions specific account types (MSA, Pro, Google) |
| `miss_p12` | Multi-step flow lacks E2E reference | Title describes a multi-step sequence (contains "then", "→", or numbered sub-steps) |

**Note**: For features that already have infrastructure (found in infra.json with `has_feature_doc: true`), `miss_p02` may not apply — the navigation path is already documented.

### Coverage Analysis (`coverage`)

For each case, determine whether existing infrastructure can support rewriting this case. This is the **most important analysis** — it directly tells the recording team what needs attention.

**Step 1: Title match** — Strip any `ID: ` prefix from both the case title and infra rewritten_titles, then compare. If matched → `status: "covered"`.

**Step 2: Feature Doc match** — For unmatched cases in features that have `has_feature_doc: true`:
1. Read the feature's `feature_doc_functions` list from infra.json
2. Determine if any documented function(s) cover the case's test point
3. Assess:
   - All relevant UI elements, navigation paths, and verification criteria are documented → `status: "doc_covered"`
   - Some related functions exist but specific UI details or sub-flows are missing → `status: "doc_partial"`
   - No relevant functions found → `status: "doc_missing"`

**Step 3: No infra** — For cases in features with no infra.json entry → `status: "no_infra"`.

**Writing conclusions**: Always provide `conclusion_en` and `conclusion_cn` — brief, specific explanations aimed at the **recording team**:
- ✅ `"Matched rewritten case STCAQA-1234"` — they know it's done
- ✅ `"Feature Doc has 'cold_start_landing' function covering cold start behavior"` — they know no recording needed
- ⚠️ `"Feature Doc has 'photo_picker_gallery' but lacks image editing page layout"` — they know exactly what to record
- ❌ `"No Feature Doc functions cover Google Calendar event search flow"` — they know full recording needed

### Quality Assessment (`quality`)

Evaluate each case against the Pre-Rewrite Quality Standard. See [`data/quality-check-pre-rewrite.md`](data/quality-check-pre-rewrite.md) for the full criteria definitions.

**Group A — Structural Completeness** (boolean per item):
- `A1_id`: Does the case have a unique identifier? (Almost always true if CSV has ID column)
- `A2_preconditions`: Are preconditions explicitly stated? Check if the Title/Steps describe the starting state.
- `A3_steps`: Does it contain executable steps, not just a summary sentence? A title-only case with no steps → fail.
- `A4_expected_result`: Does it state what "success" looks like? "work as expected" without specifics → fail.
- `A5_app_platform`: Is the target app and platform stated? (Usually provided at batch level)

**Group B — Description Quality** (pass + detail string):
- `B1_grounding`: Does it reference visible UI elements? Abstract phrases like "verify it works correctly", "check the feature" → fail.
- `B2_autonomy`: Does it start from a clean state? References to "continue from previous step" or implicit logged-in state → fail.
- `B3_granularity`: Is each step one atomic action? Compound steps like "go to settings and enable notifications and modify" → fail.
- `B4_reliability`: Is the test deterministic? "enter any text", "randomly select" → fail.

**Writing detail strings**: For each Group B failure, write a brief explanation of what specifically is wrong. Examples:
- `"Uses abstract 'verify it works correctly' without specifying observable UI elements"`
- `"Compound step: 'go to settings and enable and modify' should be split into 3 steps"`

### External Requirements (`requirements`)

Extract what external resources must be prepared **before** the GUI Agent executes this case. The agent runs inside a sandbox and can only interact via UI actions (Click, Type, Scroll, etc.).

**Target audience**: Human testers who need to prepare everything the agent cannot acquire by itself during execution. The report should answer: "What do I need to set up BEFORE launching the agent on this test batch?"

**Reference**: Read [`data/sandbox_limitations.md`](data/sandbox_limitations.md) for the full list of sandbox-blocked scenarios with concrete examples and failure modes.

**What the agent CAN do** (not requirements):
- UI actions: Click, LongPress, Drag, Scroll, Type, PressBack, PressHome, PressEnter, PressRecent, Launch, Wait, Hover, DoubleClick, Hotkey
- Multi-step in-app operations: send messages, create conversations, navigate tabs, open menus, install apps from app store
- General reasoning: the agent has LLM-level understanding and can reason about what it sees on screen

**What the agent CANNOT do** (these ARE requirements — see `sandbox_limitations.md` for details):
- **Hardware sensors & multimodal input**: no real camera (preview is black/blank), microphone (device receives no audio after tapping mic button), GPS, NFC, fingerprint, gyroscope — the sandbox has no physical sensors, so the agent cannot produce audio signals, video streams, or location data
- **Cross-device interaction**: the agent controls only ONE sandbox device — cannot operate a second device, another user's account, or coordinate multi-device scenarios
- **Network state control**: cannot toggle airplane mode, switch Wi-Fi/cellular, or simulate network conditions
- **Screen sharing**: requires system-level `MediaProjection` permission dialog + actual video stream, both unavailable in sandbox

#### 7 Requirement Categories

**📱 apps** — Apps that must be separately installed (besides the app-under-test)

⚠️ **Critical**: Distinguish real app dependencies from in-app features:
- ❌ NOT an app: "Search Outlook events" → Copilot queries Outlook via built-in connector
- ❌ NOT an app: Composer menu shows "Camera", "Photos" → these are in-app picker buttons
- ✅ IS an app: "Share image from system file manager to Copilot" → requires file manager app
- ✅ IS an app: "Open Chrome and navigate to..." → requires Chrome browser

Ask: "Does the user need to **leave** the app-under-test and interact with another app's UI?" If yes → real dependency.

**Known in-app connectors** (exclude): Outlook, OneDrive, Google Drive, Google Calendar, Calendar, Photos, Files, Camera (when accessed through the app's own UI)

Fields: `name`, `purpose`, `state`

**🔐 accounts** — Account credentials needed for testing

Detect from: MSA, AAD, Entra, Google account, Pro account, premium, enterprise, free account, SSO, OAuth, MFA, credentials, sign-in with/using.

Fields: `type` (MSA/AAD/Google/Pro/free/enterprise), `method` (email+password/OAuth/SSO), `credential` (if known from App Intro), `special` (e.g., "must have OneDrive files")

**📁 files** — Files that need to be on the device or in cloud storage

⚠️ **Normalize to base types**: image, video, audio, document, archive. Don't create fine-grained types like "Image (JPG/PNG)".

**Aggregation rule**: Group by `(base_type, location)`. Merge quantities by taking `max()` across cases. Union all size requirements and special properties. Example: Case A needs 1 image on device, Case B needs 3 images on device → summary shows "image · 3+ · device".

**Cloud files vs device files**: Separate by location. Files on "Google Drive" and files on "device storage" are different preparation tasks even if both are documents.

Fields: `type` (base type), `quantity` (numeric), `size` (if specified), `properties` (e.g., "corrupted", "resume"), `location` (device/gallery/OneDrive/Google Drive/clipboard)

**🔗 urls** — Specific URLs or link types needed

Fields: `url` (if explicit), `type` (specific/webpage/deep_link/share_link), `purpose`

**🌐 environment** — Environment requiring human/infra setup

Only include what the agent **cannot** configure itself:
- ✅ Include: VPN, device region/locale, accessibility features, dark mode, specific OS version
- ❌ Exclude: cold/warm start (sandbox config), keyboard state (agent taps), signed-in state (account requirement)

Fields: `type`, `value`, `detail`

**📲 hardware** — Hardware the sandbox lacks

Fields: `type` (camera/microphone/GPS/Bluetooth/NFC), `detail`

**📋 preconfig** — Data/state that must exist before the test starts

⚠️ **Critical**: Only true prerequisites the agent cannot create itself.

**Include** (true prerequisites):
- ✅ "User B shared a link to you" → requires external actor
- ✅ "Existing emails in Outlook inbox" → requires cloud data setup
- ✅ "Previously generated share links from 7 artifact types" → requires prior accumulated history
- ✅ "Not first time using Pages" → implies Pages was used in a prior session

**Exclude** (in-case operations the agent handles):
- ❌ "Send a message and verify response" → agent does this during the test
- ❌ "Create a new Page" → agent creates it as part of the test
- ❌ "Long press response" → agent generates the response first, then long-presses

**How to determine**: Ask two questions — (1) "Does this data ALREADY need to exist before the agent starts?" AND (2) "Is it something the agent cannot create by itself as a preliminary step within the same session?" Both must be yes.

Fields: `data_type`, `quantity`, `detail`

### Collection Hints (`feature_summary`)

After processing all cases for a feature, if the feature will need recording (no existing infrastructure, or insufficient coverage), write a `feature_summary` record with bilingual collection hints.

**Scaling guidelines**:
- **1–3 cases**: 2–4 screenshot items, 2–3 info items
- **4–7 cases**: 4–8 screenshot items, 3–6 info items
- **8+ cases**: 8+ screenshot items, 6+ info items — exhaustively cover every unique UI state and flow

**How to produce**: Read ALL case titles for this feature. For each case, identify the unique UI element, screen, or flow it tests. Merge duplicates, keep distinct items separate. The final list should be a near-complete checklist of what the recorder needs to capture.

---

## Stage 3: Render Reports (Fixed Code)

**Default: Unified report** — produces a single HTML dashboard with tab-based navigation (Ready to Execute / Blocked by Sandbox / Prerequisite Needed / Low Quality). This is the recommended output for most workflows.

```bash
# Unified Analysis report (default — single HTML with all dimensions)
python -m report.render --input analysis.jsonl --type unified --output <dir>/

# Unified with infra.json (enables richer coverage data)
python -m report.render --input analysis.jsonl --type unified --infra infra.json --output <dir>/
```

**Specialized reports** — use these only when the user explicitly requests a specific analysis dimension:

```bash
# Executability Analysis report (English only, default)
python -m report.render --input analysis.jsonl --infra infra.json --type executability --output <dir>/

# Prerequisite Gap Analysis report
python -m report.render --input analysis.jsonl --type prerequisite --output <dir>/

# Quality Analysis report
python -m report.render --input analysis.jsonl --type quality --output <dir>/

# Executability + Prerequisite
python -m report.render --input analysis.jsonl --infra infra.json --type both --output <dir>/

# All report types (unified + executability + prerequisite + quality), both EN + CN
python -m report.render --input analysis.jsonl --infra infra.json --type all --lang both --output <dir>/
```

### What the renderer does (no LLM needed)

**For unified analysis** — Classifies each case into exactly one bucket (first match wins):
1. **Sandbox Blocked** — `sandbox.blocked=true` and not `view_only`
2. **Prerequisite Needed** — has non-empty `requirements` (apps, accounts, files, etc.)
3. **Low Quality** — `quality.decision != "ready"` (Group A fails → blocked, Group B fails → rewrite recommended)
4. **Ready to Execute** — passes all above checks

Renders a single HTML with summary cards + 4 tab panels. Output: `*_unified_analysis_en.html`.

**For executability analysis** — See [`data/breakdown.md`](data/breakdown.md) for decision tree, HTML structure, recommendation keys, and CSS classes.

Steps: group cases by feature → match against infra.json → run decision tree → render 5-section HTML (en + cn) + TSV.

**For prerequisite gap analysis** — See [`data/requirement.md`](data/requirement.md) for HTML structure, aggregation rules, category-specific columns, and CSS classes.

Steps: extract `requirements` field → aggregate by category → render 3-section HTML (en + cn) + TSV.

**For quality analysis** — See [`data/quality-check-pre-rewrite.md`](data/quality-check-pre-rewrite.md) for quality criteria definitions.

Steps: read `quality` field → compute decisions → render 3-section HTML (Summary Cards / Issues Overview / Per-Case Detail) (en + cn) + TSV.

---

## STRINGS (Fixed in Renderer)

All UI text is defined in the renderer code as a bilingual dict. The LLM never writes display text — only keys that the renderer resolves.

### Missing Doc Keys

| Key | English | Chinese |
|-----|---------|---------|
| `miss_p01` | Unknown page element layout | 不知页面元素布局（按钮/图标位置/状态） |
| `miss_p02` | Unknown app initial state and navigation path | 不知 App 初始状态及到达该功能的导航路径 |
| `miss_p03` | Verification criteria unclear | 验证标准不明确，功能行为描述缺失 |
| `miss_p04` | Auth flow page sequence unknown | 认证流程页面序列和入口未知 |
| `miss_p11` | Test account credentials missing | 测试账号凭据缺失 |
| `miss_p12` | Multi-step flow lacks E2E reference | 多步骤流程缺乏端到端参考 |

### VPN Reason Keys

| Key | English | Chinese |
|-----|---------|---------|
| `vpn_reason_market` | Different markets may show different behavior; VPN needed to switch regions | 不同 market 表现可能不同，需要 VPN 切换地区 |
| `vpn_reason_region` | Region-locked content or geo-restricted features | 涉及地区限定内容或地区受限功能 |
| `vpn_reason_other` | VPN may be required for testing environment access | 测试环境可能需要 VPN 才能访问 |

---

## CSS Design System

Both report types share the same CSS root variables. Report-specific classes are documented in [`data/breakdown.md`](data/breakdown.md) and [`data/requirement.md`](data/requirement.md). Reference output examples: [`data/breakdown-template.html`](data/breakdown-template.html), [`data/requirement-template.html`](data/requirement-template.html).

```css
:root {
  --bg:#f8f9fa; --card:#fff; --border:#dee2e6;
  --text:#212529; --text2:#6c757d; --accent:#0d6efd;
  --green:#198754; --green-bg:#d1e7dd;
  --red:#dc3545; --red-bg:#f8d7da;
  --orange:#fd7e14; --orange-bg:#fff3cd;
  --gray:#adb5bd; --blue-bg:#cfe2ff; --blue:#084298;
}
```

---

## Critical Lessons (Preserved from Project Experience)

### Lesson 1: Folder Name Mismatch
Auto-generated folder names often don't match existing folders. LLM must look up `infra.json`'s actual folder names rather than guessing. Common mismatches: `"Chat UI"` (space), `"Auth_And_Account"` (& → And), `"File_Upload_Photo_Camera"` (special chars).

### Lesson 2: Language-Independent Data, Language-Dependent Rendering
All analysis produces language-neutral keys/codes. Text resolution happens ONLY in the renderer via `STRINGS[lang]`. This ensures both language reports are perfectly consistent.

### Lesson 3: Summary Cards Must Be Action-Oriented
Users care about "What do I need to do?" not "How many are executable?" Group by action: Need Recording / Quick Wins / Review Needed / Sandbox Blocked.

### Lesson 4: Action Summary Before Details
The "what to do" list comes immediately after summary cards, before detailed tables.

### Lesson 5: Collection Hints Only for Record Features
The green collection hints box appears ONLY for features needing recording. Quick wins and skip features use the simpler title/sandbox/covered table.

### Lesson 6: VPN is Feature-Level
If ANY case in a feature mentions region/market behavior, the whole feature gets a VPN badge.

### Lesson 7: View-Only Cases Should Not Be Auto-Blocked
Cases that only verify UI presence (show/display/appear) should NOT be blocked even when they mention a blocked capability (camera, voice). Mark as `👁️ View-only` instead.

### Lesson 8: Collection Hint Detail Scales with Case Count
Features with 8+ cases need exhaustively detailed hints. One generic "Settings page layout" is insufficient for 12 cases covering different flows.

### Lesson 9: Distinguish App Dependencies from In-App Connectors
"Search Outlook events" uses Copilot's built-in connector, NOT a separate Outlook app. Only flag as app dependency when the user must leave the app-under-test.

### Lesson 10: Normalize File Types
Don't create overlapping types like "Image (JPG/PNG)" and "Files/Images". Normalize to base types (image, video, document, audio, archive) and group by `(base_type, location)`.

### Lesson 11: True Prerequisites vs In-Case Operations
"Long press response → Edit in a page" is NOT a prerequisite — the agent creates the response first. Only flag data that must **already exist** before the agent starts AND that the agent cannot create itself.

---

## Procedure (What to Do When This Skill is Invoked)

### Step 0: Confirm Inputs

Ask the user for:
1. Path to the test case file (TSV/CSV)
2. App name and platform
3. Path to existing rewrite data folder (if doing breakdown)
4. Sandbox limitations file (auto-discover `sandbox_limitations.md` in data folder)
5. App Intro document (auto-discover `*_Intro.md` or `*_App_Intro.md`)
6. Which report(s): breakdown, requirement, or both

### Step 1: Run scan_infra (if breakdown)

```bash
python -m report.scan_infra --root <rewrite_root> --output <output_dir>/infra.json
```

Review the output: confirm feature count and folder names look correct.

### Step 2: Analyze — Produce analysis.jsonl

1. Write the `meta` record
2. Read each case from the CSV
3. For each case, fill a `case` record:
   - Classify feature (using Title semantics + infra.json folder list)
   - Assess sandbox (using sandbox_limitations.md)
   - Assess VPN (from Title keywords)
   - Analyze missing doc info (from Title semantics, using standard keys)
   - **Analyze coverage** (match against infra rewritten_titles → if unmatched, check Feature Doc functions → produce coverage status + bilingual conclusion)
   - Extract requirements (from Title + Steps, 7 categories)
4. After all cases: group by feature, for each feature that likely needs recording:
   - Write a `feature_summary` record with bilingual collection hints
5. Save as `analysis.jsonl`

### Step 3: Render

```bash
python -m report.render --input analysis.jsonl --infra infra.json --type both --output <dir>/
```

### Step 4: Review Output

Open the HTML reports and spot-check:
- Summary card counts match expectations
- Feature classifications are correct
- Sandbox blocked cases make sense (no false positives from view-only cases)
- Requirement extraction didn't miss obvious dependencies
- Collection hints are detailed enough for high-case-count features

---

## Extensibility

This architecture supports adding new report types without changing the analysis stage:

1. Define what fields the new report needs in the `case` record (add to schema if needed)
2. Write a new renderer in `report/<new_type>/renderer.py`
3. Add the new type to the `--type` CLI argument
4. The same `analysis.jsonl` feeds all report types

Examples of future report types:
- **Quality analysis** — rewrite readiness scoring per case
- **Execution planning** — group cases into execution batches by account/device requirements
- **Coverage matrix** — feature × test-point coverage heatmap
