---
name: extract-feature-doc
description: "Generate a feature-specific Feature_Doc.jsonl by synthesizing information from project knowledge, test case content, LLM product knowledge, and web search. Use when: a matching Feature Doc is not found in knowledge during the rewrite workflow, or when you need to create a new Feature Doc for a feature."
argument-hint: "Provide the feature name, any partial knowledge document IDs found during discovery, and the test case titles/content for context"
---

# Skill: Extract Feature Doc

## Purpose

Generate a feature-specific `Feature_Doc.jsonl` that the rewrite pipeline (`rewrite-from-doc`) needs as input. This skill is invoked when Phase 0 (Knowledge Discovery) of the orchestrator determines that no complete Feature Doc exists for the target feature.

**Core principle**: Synthesize from the best available sources — never fabricate UI details without grounding.

---

## When to Use

| Trigger | Source |
|---------|--------|
| Phase 0 found **partial/related** knowledge but no complete Feature Doc | Use found knowledge as primary source, supplement with other sources |
| Phase 0 found **no relevant** knowledge | Rely on test case content + LLM knowledge + web search |
| User explicitly asks to **create a Feature Doc** for a feature | Gather all available context and generate |

---

## Information Sources (by priority)

| Priority | Source | How to Access | What It Provides |
|----------|--------|--------------|-----------------|
| **1. Project knowledge (partial matches)** | `read(type="knowledge", resource_id=<id>)` | Related documents from Phase 0 that aren't complete Feature Docs but contain useful feature info (user guides, specs, release notes, etc.) | UI details, navigation flows, feature behavior, terminology |
| **2. Test case content** | The input CSV/TSV | Titles, steps, and expected results contain rich information about the feature's UI, navigation, and behavior | UI element names, page flows, sub-features, prerequisites |
| **3. LLM product knowledge** | LLM's training data | Well-known products (Edge, Copilot, etc.) have documented UI patterns | General navigation structure, common UI patterns, feature descriptions |
| **4. Web search** | `web_search()` or `fetch_webpage()` if available | Feature-specific documentation, UI guides, recent changes | Detailed feature behavior, screenshots, current UI state |

---

## Procedure

> **Execution policy**: Process one feature at a time. Complete the full gather → synthesize → validate cycle for one feature before starting the next. Do not batch-generate all Feature Docs at once.

### Step 1: Gather Context

Read ALL test cases for the target feature and extract these 7 dimensions:

1. **Feature scope**: What aspects of the feature are being tested (from test titles)
2. **UI elements**: Button names, menu items, page names, dialog text (from step actions and expected results)
3. **Navigation patterns**: How users reach the feature, what pages are involved (from step sequences)
4. **Platform details**: Android vs iOS differences, version requirements (from Tags or Title)
5. **Prerequisites**: Setup steps, flags, settings, account requirements mentioned in test cases
6. **Feature sub-areas**: Sub-tags in brackets (e.g., `[Search][Suggestion]`, `[Chat UI][Sign In Button]`)
7. **Cross-references**: Multiple test cases for the same feature reveal different aspects — synthesize them all

Then supplement from other sources:

- **From knowledge** (if partial matches were found in Phase 0):
   - Read each matched document via `read(type="knowledge", resource_id=<id>)`
   - Extract feature-relevant UI details, navigation flows, terminology
- **From LLM knowledge**:
   - For well-known products (Edge, Copilot, etc.), leverage training data for general UI patterns and common navigation structures
- **From web search** (if available and needed):
   - Search for feature-specific documentation, UI guides, recent changes
   - Particularly useful for uncommon features or recently changed UI

### Step 2: Synthesize Feature Doc

Combine all sources into a single `Feature_Doc.jsonl` following the schema below. For each field:
- Use the highest-priority source that provides the information
- Mark uncertain or inferred information with `(inferred)` or `(from test case)`
- Do not fabricate specific UI element names or labels that aren't grounded in any source
- The file MUST be **pretty-printed** (indented with 2 spaces), NOT a single compressed line
- All text MUST be in **English** (except test input text that specifically requires another language)

### Step 3: Validate Completeness

Before saving, run these checks:

1. **Coverage check**: Does `navigation_structure` cover all pages mentioned across ALL test cases?
2. **Sub-feature check**: Does `detailed_function_introduction` cover all sub-features referenced in test case titles?
3. **Starting state check**: Is `starting_state` specific enough for the rewrite LLM to know where execution begins?
4. **Auth check**: Are `sandbox_auth` credentials included if any test case requires authentication?
5. **JSON validity**: Verify the output is valid JSON (no trailing commas, proper quoting)
6. **Alias check**: Are common alternate names for the feature listed in `alias`?

### Step 4: Save

Save the generated `Feature_Doc.jsonl` to the workspace (e.g., `rewrite_input/<Feature>_Feature_Doc.jsonl`) so the rewrite pipeline can reference it.

### Step 5: Convert to Markdown

After saving the JSONL, convert it to a human-readable Markdown file using the `jsonl_to_md.py` script:

```sh
python jsonl_to_md.py <Feature>_Feature_Doc.jsonl
```

This produces `<Feature>_Feature_Doc.md` in the same directory. The Markdown file is the **user-facing deliverable** — upload it via the `report` tool and present the MD link to the user. Do NOT upload or link the JSONL file; it is an internal pipeline artifact.

---

## Feature Doc Schema

Generate `Feature_Doc.jsonl` with this structure (pretty-printed, 2-space indent):

```json
{
  "project": {
    "software": "<app name>",
    "platform": ["<platform>"],
    "app_version": "Latest Stable",
    "description": "<brief app description>"
  },
  "feature": {
    "name": "<feature name>",
    "alias": ["<alternate names from test cases or knowledge>"],
    "description": "<synthesized from all sources>",
    "detailed_function_introduction": {
      "<sub-feature 1>": "<description>",
      "<sub-feature 2>": "<description>"
    },
    "user_flow": ["1. <step>", "2. <step>"]
  },
  "documents": {
    "prd_path": "",
    "spec_path": "",
    "design_doc_path": ""
  },
  "prerequisites": {
    "environment": ["<from test case preconditions>"],
    "dependencies": ["<from test case tags and steps>"]
  },
  "test_environment_note": {
    "description": "<general test environment setup>",
    "authentication_guidance": "<which cases need signed-in vs signed-out state>",
    "examples_requiring_auth": ["<scenarios from test cases>"]
  },
  "sandbox_auth": {
    "description": "<auth info if needed>",
    "action": "login",
    "username": "<from knowledge or test cases>",
    "password": "<from knowledge or test cases>",
    "email": "<from knowledge or test cases>"
  },
  "navigation_structure": {
    "description": "<reconstructed from sources>",
    "pages": [
      {
        "name": "<page name>",
        "note": "<how to reach>",
        "page_elements": { "<element>": "<description>" },
        "children": [{"name": "<sub-page>", "type": "<navigation type>"}]
      }
    ]
  },
  "starting_state": {
    "description": "<initial screen state>",
    "screenshot": ""
  }
}
```

---

## Quality Requirements

| Requirement | Description |
|-------------|-------------|
| **Grounded** | Every fact traceable to knowledge, test case content, or verified web source |
| **Honest** | Mark uncertain info with `(inferred)` or `(from test case)` — do not fabricate UI details |
| **Complete** | Cover all sub-features, pages, and UI elements mentioned across ALL test cases for this feature |
| **Structured** | Follow the JSONL schema faithfully — all required fields present |
| **Actionable** | Navigation structure detailed enough for the rewrite LLM to plan paths |
| **English** | All text in English (except test input text that specifically requires another language) |
| **Formatted** | Pretty-printed JSON with 2-space indentation, NOT a single compressed line |
