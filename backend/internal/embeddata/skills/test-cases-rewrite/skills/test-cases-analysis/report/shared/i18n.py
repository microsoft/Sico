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
Bilingual UI strings for report rendering.
All display text lives here. Analysis code only uses keys (e.g. "miss_p01").
"""

STRINGS = {
    "en": {
        # ── Report titles ──
        "breakdown_title": "Executability Analysis Report",
        "breakdown_subtitle_tpl": "{n_cases} test cases · {n_features} features · Generated on {date} · Source: <code>{file}</code>",
        "requirement_title": "Prerequisite Gap Analysis Report",
        "requirement_subtitle_tpl": "{n_cases} test cases · {n_cats} requirement categories · Generated on {date} · Source: <code>{file}</code>",

        # ── Breakdown summary cards ──
        "total": "Total",
        "features_cases": "features · {c} cases",
        "need_recording": "🎥 Need Recording",
        "quick_wins": "✅ Quick Wins",
        "review_needed": "🔍 Review Needed",
        "sandbox_blocked": "⛔ Sandbox Blocked",

        # ── Breakdown section headers ──
        "action_summary": "Action Summary",
        "platform_summary": "Platform Feasibility Summary",
        "feat_overview": "Feature Overview",
        "feat_details": "Feature Details",

        # ── Action category group headers ──
        "grp_record": "🎥 Need Recording / Feature Doc",
        "grp_quick": "✅ Quick Wins — Existing Infra Sufficient",
        "grp_review": "🔍 Review Needed — Partial Coverage",
        "grp_skip": "⛔ Skip — Sandbox Cannot Execute",

        # ── Recommendation texts ──
        "rec_skip": "⛔ Skip — all cases blocked by sandbox limitations",
        "rec_skip_detail": "All {n} cases require hardware/sensor capabilities unavailable in the sandbox.",
        "rec_new": "🆕 New feature — needs full recording pipeline",
        "rec_new_detail": "No existing infrastructure found. Need: demo recording → parser → Feature Doc → rewrite.",
        "rec_new_detail_blocked": " Note: {b}/{t} cases are sandbox-blocked and will be skipped.",
        "rec_need_recording": "🎥 Has Feature Doc but needs recording",
        "rec_need_recording_detail": "Feature Doc exists but no demo recording found. Record the feature demo to enable rewrite.",
        "rec_covered": "✅ Fully covered — no action needed",
        "rec_covered_detail": "All {n} cases match existing rewritten test cases.",
        "rec_evaluate": "📝 Has infra but {n} new case(s) need review",
        "rec_evaluate_detail": "{n} case(s) not found in existing rewritten output. Review whether existing Feature Doc covers them or needs update.",

        # ── Missing doc keys ──
        "miss_p01": "Unknown page element layout",
        "miss_p02": "Unknown app initial state and navigation path",
        "miss_p03": "Verification criteria unclear",
        "miss_p04": "Auth flow page sequence unknown",
        "miss_p11": "Test account credentials missing",
        "miss_p12": "Multi-step flow lacks E2E reference",

        # ── Coverage status ──
        "cov_covered": "✅ Covered",
        "cov_doc_covered": "✅ Doc Covers",
        "cov_doc_partial": "⚠️ Partial",
        "cov_doc_missing": "❌ Not Covered",
        "cov_no_infra": "❌ No Infra",

        # ── Collection hints ──
        "collection_title": "📋 Information to Collect",
        "screenshots_needed": "Screenshots needed:",
        "info_needed": "Information to confirm/record:",

        # ── VPN ──
        "vpn_badge": "🌐 VPN Required",
        "vpn_reason_market": "Different markets may show different behavior; VPN needed to switch regions",
        "vpn_reason_region": "Region-locked content or geo-restricted features",
        "vpn_reason_other": "VPN may be required for testing environment access",

        # ── Sandbox / View-only ──
        "view_only_badge": "👁️ View-only",
        "view_only_note": "This case only verifies UI presence — no full interaction needed, feasible in sandbox",

        # ── Table headers (breakdown) ──
        "col_feature": "Feature",
        "col_cases": "Cases",
        "col_sandbox": "Sandbox",
        "col_artifacts": "Artifacts",
        "col_covered": "Covered",
        "col_new": "New",
        "col_recommendation": "Recommendation",
        "col_test_point": "Test Point",
        "col_missing": "Missing",
        "col_reason": "Reason",
        "col_case_id": "Case ID",
        "col_title": "Title",

        # ── Infra box ──
        "existing_infra": "Existing Infrastructure",
        "no_infra": "📭 No Existing Infrastructure",

        # ── Requirement summary cards ──
        "total_cases": "Total Cases",
        "with_reqs": "Cases with Requirements",
        "cat_apps": "📱 Apps to Download",
        "cat_accounts": "🔐 Account Credentials",
        "cat_files": "📁 Required Files",
        "cat_urls": "🔗 Required URLs",
        "cat_environment": "🌐 Special Environment",
        "cat_hardware": "📲 Hardware Requirements",
        "cat_preconfig": "📋 Pre-configured Data",
        "blocked": "⛔ Platform Blocked",
        "blocked_badge": "⛔ Platform Blocked: {cat}",
        "blocked_sub": "cases blocked · {c} skipped",
        "blocked_note": "This case requires capabilities unavailable in the sandbox. No preparation needed.",
        "no_reqs": "No external requirements detected",
        "cases_analyzed": "cases analyzed",
        "of_total": "of total",
        "unique_items": "items",
        "cases_lc": "cases",

        # ── Requirement section headers ──
        "summary_section": "Requirements Summary",
        "detail_section": "Per-Case Requirements",

        # ── Requirement table headers ──
        "col_app_name": "App Name",
        "col_purpose": "Purpose",
        "col_state": "Required State",
        "col_ref_cases": "Referenced Cases",
        "col_acct_type": "Account Type",
        "col_sign_in": "Sign-in Method",
        "col_special": "Special Requirements",
        "col_file_type": "File Type",
        "col_quantity": "Quantity",
        "col_size": "Size Requirements",
        "col_properties": "Properties",
        "col_location": "Location",
        "col_url": "URL / Link Type",
        "col_env_type": "Environment Type",
        "col_env_value": "Value / Setting",
        "col_hw_type": "Hardware",
        "col_detail": "Detail",
        "col_data_type": "Data Type",
        "col_requirements": "Requirements",

        # ── Platform feasibility ──
        "risk_category": "Limitation Category",
        "risk_level": "Risk Level",
        "risk_desc": "Description",
        "risk_affected": "Affected Cases",

        # ── Footer ──
        "footer_tpl": "Generated on {date} · Input: {file} ({n} cases) · Report: {report_type}",

        # ── Quality check ──
        "quality_title": "Quality Analysis Report",
        "quality_subtitle_tpl": "{n_cases} test cases · Generated on {date} · Source: <code>{file}</code>",
        "q_cases": "cases",
        "q_ready": "✅ Ready",
        "q_rewrite_rec": "📝 Rewrite Recommended",
        "q_blocked": "⛔ Blocked",
        "q_issues_overview": "Issues Overview",
        "q_per_case": "Per-Case Quality Detail",
        "q_group_a": "Group A",
        "q_group_b": "Group B",
        "q_structural": "Structural Completeness",
        "q_description": "Description Quality",
        "q_check_item": "Check Item",
        "q_fail_count": "Failures",
        "q_issues": "Issues",
        "q_no_issues": "✅ All test cases pass quality checks — no issues found.",
        "q_decision_ready": "✅ Ready for Execution",
        "q_decision_rewrite_recommended": "📝 Rewrite Recommended",
        "q_decision_blocked": "⛔ Blocked — Fix Required",
        "q_A1_id": "A-1 ID / Number",
        "q_A2_preconditions": "A-2 Preconditions",
        "q_A3_steps": "A-3 Steps",
        "q_A4_expected_result": "A-4 Expected Result",
        "q_A5_app_platform": "A-5 App / Platform",
        "q_B1_grounding": "B-1 Grounding",
        "q_B2_autonomy": "B-2 Autonomy",
        "q_B3_granularity": "B-3 Granularity",
        "q_B4_reliability": "B-4 Reliability",
        "q_A1_id_short": "ID",
        "q_A2_preconditions_short": "Precond",
        "q_A3_steps_short": "Steps",
        "q_A4_expected_result_short": "Expected",
        "q_A5_app_platform_short": "App/Plat",
        "q_B1_grounding_short": "Grounding",
        "q_B2_autonomy_short": "Autonomy",
        "q_B3_granularity_short": "Granularity",
        "q_B4_reliability_short": "Reliability",
    },
    "cn": {
        # ── Report titles ──
        "breakdown_title": "可执行性分析报告",
        "breakdown_subtitle_tpl": "{n_cases} 条用例 · {n_features} 个 Feature · 生成于 {date} · 来源: <code>{file}</code>",
        "requirement_title": "前置条件差距分析报告",
        "requirement_subtitle_tpl": "{n_cases} 条用例 · {n_cats} 个需求类别 · 生成于 {date} · 来源: <code>{file}</code>",

        # ── Breakdown summary cards ──
        "total": "总计",
        "features_cases": "个 Feature · {c} 条用例",
        "need_recording": "🎥 需要录制",
        "quick_wins": "✅ 可直接复用",
        "review_needed": "🔍 需要评估",
        "sandbox_blocked": "⛔ 沙箱受阻",

        # ── Breakdown section headers ──
        "action_summary": "行动汇总",
        "platform_summary": "平台可行性汇总",
        "feat_overview": "Feature 总览",
        "feat_details": "Feature 详情",

        # ── Action category group headers ──
        "grp_record": "🎥 需要录制 / Feature Doc",
        "grp_quick": "✅ 可直接复用 — 已有完整基础设施",
        "grp_review": "🔍 需要评估 — 部分覆盖",
        "grp_skip": "⛔ 跳过 — 沙箱无法执行",

        # ── Recommendation texts ──
        "rec_skip": "⛔ 跳过 — 所有用例被沙箱限制阻塞",
        "rec_skip_detail": "全部 {n} 条用例需要沙箱不支持的硬件/传感器能力。",
        "rec_new": "🆕 新 Feature — 需要完整录制流水线",
        "rec_new_detail": "未找到已有基础设施。需要：演示录制 → 解析 → Feature Doc → 改写。",
        "rec_new_detail_blocked": " 注意：{b}/{t} 条用例被沙箱限制阻塞，将被跳过。",
        "rec_need_recording": "🎥 有 Feature Doc 但需要录制",
        "rec_need_recording_detail": "Feature Doc 已存在但未找到演示录制。需要录制功能演示以启用改写。",
        "rec_covered": "✅ 完全覆盖 — 无需操作",
        "rec_covered_detail": "全部 {n} 条用例在已有改写结果中已匹配。",
        "rec_evaluate": "📝 有基础设施但 {n} 条新增用例需要评估",
        "rec_evaluate_detail": "{n} 条用例未在已有改写输出中找到。需评估现有 Feature Doc 是否覆盖或需要更新。",

        # ── Missing doc keys ──
        "miss_p01": "不知页面元素布局（按钮/图标位置/状态）",
        "miss_p02": "不知 App 初始状态及到达该功能的导航路径",
        "miss_p03": "验证标准不明确，功能行为描述缺失",
        "miss_p04": "认证流程页面序列和入口未知",
        "miss_p11": "测试账号凭据缺失",
        "miss_p12": "多步骤流程缺乏端到端参考",

        # ── Coverage status ──
        "cov_covered": "✅ 已覆盖",
        "cov_doc_covered": "✅ Doc 可覆盖",
        "cov_doc_partial": "⚠️ 部分覆盖",
        "cov_doc_missing": "❌ 未覆盖",
        "cov_no_infra": "❌ 无基础设施",

        # ── Collection hints ──
        "collection_title": "📋 需要人工收集的信息",
        "screenshots_needed": "需要截图的页面/状态：",
        "info_needed": "需要确认/记录的信息：",

        # ── VPN ──
        "vpn_badge": "🌐 需要 VPN",
        "vpn_reason_market": "不同 market 表现可能不同，需要 VPN 切换地区",
        "vpn_reason_region": "涉及地区限定内容或地区受限功能",
        "vpn_reason_other": "测试环境可能需要 VPN 才能访问",

        # ── Sandbox / View-only ──
        "view_only_badge": "👁️ 仅查看",
        "view_only_note": "该用例仅验证界面展示——无需完整交互，沙箱可执行",

        # ── Table headers (breakdown) ──
        "col_feature": "Feature",
        "col_cases": "用例数",
        "col_sandbox": "沙箱",
        "col_artifacts": "基础设施",
        "col_covered": "已覆盖",
        "col_new": "新增",
        "col_recommendation": "建议",
        "col_test_point": "测试点",
        "col_missing": "缺失项",
        "col_reason": "缘由",
        "col_case_id": "用例 ID",
        "col_title": "标题",

        # ── Infra box ──
        "existing_infra": "已有基础设施",
        "no_infra": "📭 无已有基础设施",

        # ── Requirement summary cards ──
        "total_cases": "总用例数",
        "with_reqs": "有外部需求的用例",
        "cat_apps": "📱 需要下载的 App",
        "cat_accounts": "🔐 所需账号密码",
        "cat_files": "📁 所需文件",
        "cat_urls": "🔗 所需 URL",
        "cat_environment": "🌐 特殊环境要求",
        "cat_hardware": "📲 硬件需求",
        "cat_preconfig": "📋 预置数据/状态",
        "blocked": "⛔ 平台不支持",
        "blocked_badge": "⛔ 平台不支持: {cat}",
        "blocked_sub": "条被阻塞 · 跳过 {c} 条",
        "blocked_note": "该用例需要沙箱不支持的能力，无需准备。",
        "no_reqs": "未检测到外部需求",
        "cases_analyzed": "条用例已分析",
        "of_total": "占总数",
        "unique_items": "项",
        "cases_lc": "条用例",

        # ── Requirement section headers ──
        "summary_section": "需求汇总",
        "detail_section": "逐条用例需求",

        # ── Requirement table headers ──
        "col_app_name": "App 名称",
        "col_purpose": "用途",
        "col_state": "要求状态",
        "col_ref_cases": "关联用例",
        "col_acct_type": "账号类型",
        "col_sign_in": "登录方式",
        "col_special": "特殊要求",
        "col_file_type": "文件类型",
        "col_quantity": "数量",
        "col_size": "大小要求",
        "col_properties": "特殊属性",
        "col_location": "位置",
        "col_url": "URL / 链接类型",
        "col_env_type": "环境类型",
        "col_env_value": "值 / 设置",
        "col_hw_type": "硬件",
        "col_detail": "详细信息",
        "col_data_type": "数据类型",
        "col_requirements": "外部需求",

        # ── Platform feasibility ──
        "risk_category": "限制类别",
        "risk_level": "风险等级",
        "risk_desc": "描述",
        "risk_affected": "影响用例",

        # ── Footer ──
        "footer_tpl": "生成于 {date} · 输入: {file} ({n} 条用例) · 报告类型: {report_type}",

        # ── Quality check ──
        "quality_title": "质量分析报告",
        "quality_subtitle_tpl": "{n_cases} 条用例 · 生成于 {date} · 来源: <code>{file}</code>",
        "q_cases": "条用例",
        "q_ready": "✅ 可直接执行",
        "q_rewrite_rec": "📝 建议改写",
        "q_blocked": "⛔ 需修复",
        "q_issues_overview": "问题总览",
        "q_per_case": "逐条用例质量详情",
        "q_group_a": "A 组",
        "q_group_b": "B 组",
        "q_structural": "结构完整性",
        "q_description": "描述质量",
        "q_check_item": "检查项",
        "q_fail_count": "不通过数",
        "q_issues": "问题详情",
        "q_no_issues": "✅ 所有用例均通过质量检查，未发现问题。",
        "q_decision_ready": "✅ 可直接执行",
        "q_decision_rewrite_recommended": "📝 建议改写",
        "q_decision_blocked": "⛔ 需修复 — 存在阻塞问题",
        "q_A1_id": "A-1 编号",
        "q_A2_preconditions": "A-2 前置条件",
        "q_A3_steps": "A-3 步骤",
        "q_A4_expected_result": "A-4 预期结果",
        "q_A5_app_platform": "A-5 应用/平台",
        "q_B1_grounding": "B-1 界面锚定",
        "q_B2_autonomy": "B-2 自主性",
        "q_B3_granularity": "B-3 粒度",
        "q_B4_reliability": "B-4 可靠性",
        "q_A1_id_short": "编号",
        "q_A2_preconditions_short": "前置条件",
        "q_A3_steps_short": "步骤",
        "q_A4_expected_result_short": "预期结果",
        "q_A5_app_platform_short": "应用/平台",
        "q_B1_grounding_short": "界面锚定",
        "q_B2_autonomy_short": "自主性",
        "q_B3_granularity_short": "粒度",
        "q_B4_reliability_short": "可靠性",
    },
}


def S(key: str, lang: str = "en", **kwargs) -> str:
    """Resolve a string key to display text. Supports .format() kwargs."""
    text = STRINGS.get(lang, STRINGS["en"]).get(key, key)
    if kwargs:
        try:
            text = text.format(**kwargs)
        except (KeyError, IndexError):
            pass
    return text
