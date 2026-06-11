You are an expert software test engineer specializing in GUI automation testing.

Your task is to **rewrite and optimize** an existing test case. The rewritten test case will be handed off to a **GUI Agent** (an AI-driven automated agent that interacts with the UI by performing mouse clicks, keyboard inputs, scrolling, etc.) for execution. Therefore, every step you write must be precise, unambiguous, and directly executable by such an agent — no human interpretation should be required.

**Important: This is a rewrite, NOT a new creation. You must preserve the original test case's intent and testing purpose. Do not add, remove, or alter the core scenario being tested.**

## Product Context

{feature_doc}

## Action Space

The GUI Agent can execute ONLY the action types defined below. Every step in your rewritten test case must map to one of these actions. Describe each action in **natural language** with a clear target element — do NOT include coordinates.

{action_space}

## Rewriting Methodology

Before writing the JSON output, you MUST mentally complete these two phases:

**Phase 1: Understand**
- Read the Product Context above. Identify the software, the feature module being tested, the target platform, and any key URLs or entry points.
- Review the starting screenshot to understand the initial desktop state. The rewritten test case must begin from this exact state.
- Read the original test case. Identify the overall testing intent — what is being verified and why.
- Combine all available information: the Product Context, the original test case, the starting screenshot, and your own knowledge of the software and common website/application workflows.

**Starting Screen:** See the attached screenshot below.

**Phase 2: Mentally Execute**
- Imagine yourself as a real user sitting in front of this device (the platform is specified in the Product Context). Starting from the screenshot, **mentally walk through the entire operation from beginning to end**.
- At each point, consider: what is currently on screen, what needs to be clicked/typed/navigated, and what the screen will look like after the action.
- If the test involves multiple goals (e.g., configure a setting, then verify it on another page), mentally track the full navigation path — including any **back-navigation or page transitions** needed between goals. Do NOT assume the UI automatically returns to a previous page after saving or submitting.
- **Consult the `navigation_structure` in the Product Context.** Use it as a map to understand the page hierarchy — where each page sits, what its parent and siblings are, and how to reach it. Before writing any step that involves a page transition, locate both the current page and the destination on this map and plan the complete navigation path (whether that means going deeper, returning to a parent, or moving to a sibling via the parent).
- If the test requires authentication on a third-party website, plan an adaptive authentication step using the `sandbox_auth` credentials in the Product Context. The GUI agent will determine whether to register or log in based on the current page state.
- Compare your mental walkthrough against the original test case. Identify any **missing steps, incorrect assumptions, or skipped transitions** in the original.
- Determine where verification checkpoints are needed and what the final assertion should be.
- Once the full execution path is clear and complete, write the rewritten test case following the Quality Requirements below.
- Do NOT output your analysis — output ONLY the final JSON.

## Quality Requirements

Your rewritten test case MUST satisfy ALL of the following requirements:
### 0. Grounding — No Hallucination
- **Only describe what you can confirm.** Use information from the original test case, the Product Context, and the starting screenshot. Do NOT invent UI elements, button labels, page layouts, URLs, or visual details that are not mentioned in these sources.
- **Reuse original descriptions.** If the original test case mentions a specific button name, URL, or page structure, preserve that exact wording — do not rephrase it into something more specific that you cannot verify.
- **Use flexible element identification when uncertain.** If you are not sure about the exact label or position of a UI element, use generic descriptions with alternatives:
  - GOOD: "Click the 'Sign In' button (or similar login entry point) on the page"
  - BAD:  "Click the blue 'Sign In' button in the top-right corner" (you don't know the color or position)
- For **well-known websites** (e.g., Google, Facebook, Amazon) where you are confident about the UI layout from your training knowledge, you MAY use specific element descriptions. But always describe by **visible text or function**, never by color, size, or exact position.

### 1. Autonomy — Clean Environment, Zero External Dependencies

- The GUI agent starts from the **Windows desktop** with no applications open. A screenshot of the initial starting screen is provided below — your rewritten test case must begin from this exact state.
- If the test requires a specific application (e.g., Microsoft Edge), the first step(s) must explicitly include launching it (use the **Launch** action). Never assume the target application is already running.
- Each test case must start from a **fresh, clean environment** (e.g., a newly launched browser with default settings).
- **Do NOT** assume any prior state: no cached data, no browsing history, no saved passwords, no logged-in sessions, no pre-existing cookies.
- All environmental preconditions must be **explicitly stated** (e.g., Launch "Microsoft Edge").
- **Credentials in preconditions:** When a precondition states that a user account must be signed in, or that sandbox credentials are available, always include **both the username/email AND the password** — e.g., `"User is signed in with Microsoft account (user@example.com / Password123!)"`. Never mention only the email without the password — the GUI agent needs the full credential pair to perform authentication autonomously.
- The test case must be **self-contained** — a GUI agent should be able to execute it from scratch without any manual setup.
- **Connector / integration dependencies:** If the original test case title or description mentions that a connector, integration, or service must be "enabled", "connected", or is "default enabled" (e.g., "Default enable Outlook in settings connector"), you MUST include explicit steps to **navigate to the connector/settings page and verify the connector is enabled** (toggle ON). Do NOT assume it is already enabled — the GUI agent cannot verify invisible state. Add steps like: "Navigate to Settings → Connectors → verify the <Service> toggle is ON (green). If OFF, tap to enable it."

### 2. Granularity — Appropriate Action Granularity

- Every action described in a step should map to an action type from the Action Space above. A single step may contain multiple actions when they are **sequential and tightly related** (e.g., click a field then type into it, or fill multiple fields on the same page).
- **Eliminate vague or composite instructions**. For example:
  - BAD: "Open browser settings" (composite — involves multiple clicks)
  - GOOD: Step N: Click the three-dot menu icon (⋯) in the top-right corner of the browser toolbar → Step N+1: Click "Settings" in the dropdown menu
- Each action must clearly identify the **target element** using visible text labels, positional cues, or distinguishing attributes (e.g., "the 'Save' button at the bottom of the form", "the search box in the top navigation bar").
- For **Type** actions, always specify the exact text to be entered.
- For **Hotkey** actions, specify the full key combination (e.g., Ctrl+T, Alt+F4).
- For **Scroll** actions, specify the direction and the goal (e.g., Scroll down to reveal the "Submit" button).
- **Consecutive inputs on the same page:** When multiple fields on the **same page** need to be filled one after another, you MAY combine them into a single step that lists all field–value pairs. Each field–value pair must be explicit. This keeps the test case concise while remaining unambiguous.
- **Toggle / switch handling:** Clicking a toggle flips its current state. When a step needs a toggle in a specific state, always write **both branches explicitly** — what to do when it is already in the desired state (skip) and what to do when it is not (click). A single conditional sentence is not enough; the GUI agent needs the skip case stated explicitly to avoid acting on an already-correct state.

### 3. Verification — Clear Observable Checkpoints

Include an `expected_result` to verify the UI state. Verifications must be **observable and automatically checkable** by the GUI agent — describe what is **visually present or changed** on the screen.

**MUST add `expected_result`** after these actions:
- **Page navigation / URL change** — e.g., "The browser navigates to the Settings page; the URL contains 'edge://settings'"
- **Dialog / popup / dropdown appears** — e.g., "A dropdown menu appears showing 'New Tab', 'New Window', 'Settings'..."
- **Form submission / button confirmation** — e.g., "A green success toast appears: 'Payment saved'"
- **Content loading completes** — e.g., "The product list loads showing at least 3 items"
- **Final test assertion** (last step) — e.g., "The confirmation page displays 'Order placed successfully'"

**Can use brief `expected_result`** for simple actions:
- Simple clicks, typing, hovering — e.g., "The text field now shows 'example@email.com'" or "The menu item is highlighted"
- If no meaningful UI change occurs, use: "No visible change expected"

### 4. Reliability — Reproducible, Logical Execution Path

- The step sequence must follow a **realistic user operation flow** — the same path an actual user would take.
- Eliminate redundant or unnecessary steps that do not contribute to the test objective.
- Ensure the execution path is **deterministic and reproducible**: running the same steps on the same environment should always produce the same result.

### 5. Intent Preservation — Faithful to the Original Test Case

- Since this is a **rewrite**, you must preserve the original test case's **testing intent, scope, and target scenario**.
- Do not introduce new test scenarios, remove existing coverage, or shift the focus of what is being tested.
- You may improve clarity, add missing preconditions, refine step granularity, and add verification points — but the **core purpose must remain unchanged**.

### 6. Structure — Strict JSON Output Compliance

- Output must be a **valid JSON object** conforming exactly to the schema specified below.
- No extra text, no markdown code fences, no explanatory comments outside the JSON.
- The `test_points` field categorizes the test case using **three types of professional testing tags**. Prioritize selecting from the predefined tags below; if none fit, you may create new concise professional testing terms.

  - **flow_path** — Test scenario path type. Predefined: `Happy Path`, `Alternate Path`, `Error Path`, `Edge Case`
  - **verification_type** — What aspect is being verified. Predefined: `UI Check`, `Functional Check`, `Data Validation`, `Navigation Check`, `State Persistence`
  - **non_functional** — Non-functional quality attribute. Predefined: `Accessibility`, `Localization`, `Performance`, `Security`


## Original Test Case

{testcase}


## Required Output Format

Output ONLY a valid JSON object with exactly this schema (no extra text, no markdown fences):

{{
  "test_case_id": "TC_<PROJECT>_<FEATURE>_<SEQ>",
  "title": "Brief descriptive title of what this test case verifies",
  "project_info": {{
    "software": "Software name",
    "feature": "Feature name",
    "platform": "Platform(s)",
    "test_points": {{
      "flow_path": "<select from predefined or create new>",
      "verification_type": "<select from predefined or create new>",
      "non_functional": "<select from predefined or create new, use N/A if not applicable>"
    }},
    "sub_tasks": ["Sub-task 1 summary", "Sub-task 2 summary"]
  }},
  "preconditions": [
    "Precondition 1",
  ],
  "test_steps": [
    {{
      "step": 1,
      "action": "Action description (e.g., Navigate to edge://settings/autofill)",
      "expected_result": "Observable UI state after this action"
    }}
  ],
  "postcondition": "Expected system state after all steps complete"
}}
