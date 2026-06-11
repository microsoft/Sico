
You are recommending 3 starter tasks for a Digital Worker (DW) who has just joined a project team.

## Step 1 — Read the project knowledge

For each file, note what artifact it contains and what action could be performed on it.
If no files are provided, skip to Path B in Step 2.

## Step 2 — Choose a path

**Path A — Knowledge files exist:**
Generate 3 tasks, each referencing a specific file name or artifact from Step 1.
Cross-reference with the Skill Description to ensure each task is within this DW's capability.
Each task is 1 sentence written as a natural request from the teammate to the DW:
- Mention the specific artifact by name
- End with a clear deliverable (e.g. "and generate the regression report", "and flag the gaps")
- Order by dependency: quick executable task first, deeper analysis last

**Path B — Fallback (no knowledge files):**
Using the Skill Name and Skill Description, generate 3 tasks representing typical high-value starting points for this role.
Each task is 1 sentence written as a natural request from the teammate to the DW:
- Be specific to the skill's core capabilities from the Skill Description
- End with a clear deliverable


Output exactly one JSON object with a `tasks` array containing exactly 3 task objects.

Do NOT add:
- numbering
- bullet points
- labels
- prefixes
- explanations

For each task, pick one numeric icon value from the following enum list:
1. fallback
2. build
3. think
4. write
5. research

If you cannot determine a more specific icon based on the task, use 1 (fallback) as the default.

Example format:
```json
{
    "tasks": [
        {
            "message": "Run the smoke test cases in smoke-test-cases.xlsx and generate the regression report.",
            "icon": 2
        },
        {
            "message": "Review the regression checklist and flag any uncovered release risks.",
            "icon": 5
        },
        {
            "message": "Read the release notes and identify which new features need test coverage added.",
            "icon": 3
        }
    ]
}
```



---

Examples:

Path A:
Project Knowledge:
smoke-test-cases.xlsx — Contains 42 smoke test cases covering core user flows for the Copilot extension
regression-checklist.md — A checklist of 18 regression items from the last 3 release cycles
release-v2.3-notes.pdf — Release notes listing 7 new features shipped in v2.3

Skill Name: QA Tester
Skill Description: Designs and executes test cases, identifies regressions, logs bugs with reproduction steps, and produces test summary reports

Output:
```json
{
    "tasks": [
        {
            "message": "Help me run the smoke test cases and generate the regression report.",
            "icon": 2
        },
        {
            "message": "Review the regression checklist and flag any items that weren't covered in the last cycle.",
            "icon": 5
        },
        {
            "message": "Read the v2.3 release notes and identify which new features need test coverage added.",
            "icon": 3
        }
    ]
}
```

---

Path B:
Skill Name: QA Tester
Skill Description: Designs and executes test cases, identifies regressions, logs bugs with reproduction steps, and produces test summary reports

Output:
```json
{
    "tasks": [
        {
            "message": "Write a test plan for the checkout flow covering happy path and edge cases.",
            "icon": 4
        },
        {
            "message": "Run exploratory testing on the product tagging feature and log any bugs you find.",
            "icon": 2
        },
        {
            "message": "Review the current bug backlog and tell me which issues are highest risk for the next release.",
            "icon": 5
        }
    ]
}
```

---

Below are the actual project knowledge and skill context for generating the tasks. Return only the JSON object without markdown fences or extra text.

Project knowledge list:
{{knowledge_list}}

Skills list:
{{skills_list}}