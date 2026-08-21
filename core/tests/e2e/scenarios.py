"""The scenario table. One entry per behaviour we want a real turn to exhibit."""

from __future__ import annotations

from dataclasses import dataclass

ANDROID_TESTER = "Android Tester"
ARTIST_3D = "3D Artist"
PRODUCT_MANAGER = "Product Manager"
MARKETING = "Marketing"

# Anything that would start real work. Scenarios that tell the agent not to act
# must not call these.
EXECUTION_TOOLS = ("delegate", "run_command", "sandbox_acquire", "sandbox_release", "sandbox_reset")


@dataclass(frozen=True)
class Scenario:
    name: str
    agent_role: str
    message: str
    expect_batch: bool = False
    min_batch_total: int | None = None
    max_batches: int | None = None
    max_final_chars: int | None = None
    forbidden_tool_names: tuple[str, ...] = ()
    expected_plan_text: tuple[str, ...] = ()
    forbidden_plan_text: tuple[str, ...] = ()
    expected_final_text: tuple[str, ...] = ()
    forbidden_final_pattern: str = ""
    max_seconds: float = 180.0
    slow_first_event_ok: bool = False


def _role_echo_delegate(role: str, label: str) -> Scenario:
    """A non-Android agent still reaches the generic runtime, without borrowing Android wording."""
    return Scenario(
        name=f"{label}_echo_delegate",
        agent_role=role,
        message=(
            "Use delegate(request_json) with one instructions source prebound to builtin:echo to run one local echo "
            f"task titled {label} generic result "
            f"with message {label} generic result ok. Return the execution summary URL if one is produced."
        ),
        expect_batch=True,
        min_batch_total=1,
        max_batches=1,
    )


ROUTING = (
    Scenario(
        name="greeting_answers_without_tools",
        agent_role=ANDROID_TESTER,
        message="hi",
        forbidden_tool_names=EXECUTION_TOOLS,
        max_seconds=90,
    ),
    Scenario(
        name="literal_reply_answers_without_tools",
        agent_role=ANDROID_TESTER,
        message="Reply exactly: acceptance smoke ok",
        forbidden_tool_names=EXECUTION_TOOLS,
        expected_final_text=("acceptance smoke ok",),
        max_seconds=90,
    ),
)

DELEGATION = (
    Scenario(
        name="single_case_echo_batch",
        agent_role=ANDROID_TESTER,
        message=(
            "Use delegate(request_json) with one instructions source prebound to builtin:echo to execute one "
            "isolated local echo test case. "
            "Task title: Acceptance single echo. Echo message: single delegate ok. "
            "Return the execution summary URL if one is produced."
        ),
        expect_batch=True,
        min_batch_total=1,
        max_batches=1,
    ),
    Scenario(
        name="three_case_echo_batch",
        agent_role=ANDROID_TESTER,
        message=(
            "Use one delegate(request_json) call with three instruction items prebound to builtin:echo in one batch. "
            "Case 1 message: alpha ok. Case 2 message: beta ok. Case 3 message: gamma ok. "
            "Do not inspect skill source before delegating."
        ),
        expect_batch=True,
        min_batch_total=3,
        max_batches=1,
    ),
    Scenario(
        name="four_case_echo_batch",
        agent_role=ANDROID_TESTER,
        message=(
            "Use one delegate(request_json) call for exactly four instruction items prebound to builtin:echo in "
            "one batch, no sandbox. "
            "Messages: matrix one ok, matrix two ok, matrix three ok, matrix four ok. "
            "Summarize the digest of all four case results."
        ),
        expect_batch=True,
        min_batch_total=4,
        max_batches=1,
        max_seconds=240,
    ),
    Scenario(
        name="delegates_without_reading_skill_source",
        agent_role=ANDROID_TESTER,
        message=(
            "For this executable tester capability, delegate first without reading SKILL.md or source files. "
            "Run one local echo task titled Delegate first check with message delegate first ok."
        ),
        expect_batch=True,
        min_batch_total=1,
        max_batches=1,
    ),
    Scenario(
        name="final_response_stays_short",
        agent_role=ANDROID_TESTER,
        message=(
            "Use delegate(request_json) with one instructions source prebound to builtin:echo to run one local echo "
            "test titled Concise final response "
            "with message concise ok. Keep the final answer concise."
        ),
        expect_batch=True,
        min_batch_total=1,
        max_batches=1,
        max_final_chars=1200,
    ),
    _role_echo_delegate(ARTIST_3D, "artist_3d"),
    _role_echo_delegate(PRODUCT_MANAGER, "product_manager"),
    _role_echo_delegate(MARKETING, "marketing"),
)

NO_EXECUTION = (
    Scenario(
        name="underspecified_request_asks_instead_of_running",
        agent_role=ANDROID_TESTER,
        message=(
            "Please test it. I have not provided a target, file, URL, or case ID. "
            "If the request is underspecified, ask for the missing target instead of running the delegate tool."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="unknown_case_id_asks_for_the_source",
        agent_role=ANDROID_TESTER,
        message=(
            "请执行测试用例 SICO-UNKNOWN-001。当前请求没有提供附件、用例内容或其他可访问来源。"
            "如果找不到可靠来源，请询问用户补充用例内容，不要执行测试。"
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="docs_summary_reads_but_does_not_run",
        agent_role=ANDROID_TESTER,
        message=(
            "Read README.md and docs/quickstart.md if useful, then summarize local startup commands. "
            "Do not run commands, do not run tests, and do not delegate this as a task."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        # A docs question must not wander into the Android skill's source.
        forbidden_final_pattern=r"android_tester|python\s+-m\s+android_tester|android capability entrypoint",
        slow_first_event_ok=True,
        max_seconds=240,
    ),
    Scenario(
        name="source_debug_keeps_its_read_tools",
        agent_role=ANDROID_TESTER,
        message=(
            "Debug the duplicate delegation guard implementation by inspecting workspace source only. "
            "Use context/read/grep if available. Do not execute tests and do not delegate. "
            "If the relevant source is not present in the workspace, say that."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        # Reading is allowed on this route; claiming otherwise is the regression.
        forbidden_final_pattern=(
            r"\bcontext\b.*\bread\b.*\bgrep\b.*(?:unavailable|not available|aren['\u2019]t available|are not available)"
        ),
        slow_first_event_ok=True,
        max_seconds=240,
    ),
    Scenario(
        name="tool_choice_explanation_takes_no_action",
        agent_role=ANDROID_TESTER,
        message=(
            "Do not execute anything. For a hypothetical request to install an Android APK and verify launch, "
            "briefly explain whether you would choose a pluggable skill, delegation, or generic file tools, and why."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="web_test_explanation_takes_no_action",
        agent_role=ANDROID_TESTER,
        message=(
            "Do not execute the web test. Analyze how you would validate checkout in Playwright, what evidence you "
            "would collect, and whether delegation would be appropriate."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="product_research_takes_no_action",
        agent_role=ANDROID_TESTER,
        message="不要执行，只分析一个产品调研方案：比较 Copilot 类产品时需要看哪些指标、信息来源和输出结构。",
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="artist_brief_takes_no_action",
        agent_role=ARTIST_3D,
        message=(
            "Do not execute anything. As the 3D Artist, outline the information you need before creating "
            "a game-ready low-poly robot mascot model. Keep it concise."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="product_manager_outline_takes_no_action",
        agent_role=PRODUCT_MANAGER,
        message=(
            "Do not execute anything. As the Product Manager, draft a concise PRD outline for a Team Inbox "
            "Automation feature, including problem, users, success metrics, and risks."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
    Scenario(
        name="marketing_positioning_takes_no_action",
        agent_role=MARKETING,
        message=(
            "Do not execute anything. As the Marketing agent, write concise positioning for a B2B Team Inbox "
            "Automation product: audience, category, differentiated value, and tagline."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        slow_first_event_ok=True,
    ),
)

# The expected text on these three is domain vocabulary the skill card supplies,
# so it stands in for "the card was actually consulted".
SKILL_GUIDANCE = (
    Scenario(
        name="artist_skill_guidance_takes_no_action",
        agent_role=ARTIST_3D,
        message=(
            "Do not execute anything. As the 3D Artist, use the ai-3d-model skill guidance to outline a compact production "
            "brief for a game-ready GLB of a friendly low-poly robot mascot with clean topology constraints."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        expected_final_text=("GLB", "topology"),
        slow_first_event_ok=True,
    ),
    Scenario(
        name="product_manager_skill_guidance_takes_no_action",
        agent_role=PRODUCT_MANAGER,
        message=(
            "Do not execute anything. As the Product Manager, use the frontend-slides skill guidance to outline a compact HTML "
            "slide deck for Team Inbox Automation with three slides: problem, workflow, and rollout."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        expected_final_text=("slide",),
        slow_first_event_ok=True,
    ),
    Scenario(
        name="marketing_skill_guidance_takes_no_action",
        agent_role=MARKETING,
        message=(
            "Do not execute anything. As the Marketing agent, use the image-generator skill guidance to write a production-ready "
            "1024x1024 launch poster prompt for Team Inbox Automation with clean SaaS visual direction."
        ),
        forbidden_tool_names=EXECUTION_TOOLS,
        expected_final_text=("1024x1024",),
        slow_first_event_ok=True,
    ),
)

SCENARIOS: tuple[Scenario, ...] = ROUTING + DELEGATION + NO_EXECUTION + SKILL_GUIDANCE
