-- Rollback Phase 1: restore agent-level LLM config.

-- 1. Restore agent-level LLM config table.
CREATE TABLE `t_single_agent_llmhubs_config` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key id',
    `agent_id` varchar(128) NOT NULL COMMENT 'Agent ID',
    `model_keys` json NULL COMMENT 'Selected llmhub model keys',
    `default_global_model_key` varchar(128) NOT NULL DEFAULT '' COMMENT 'Default global llmhub model key',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE KEY `uniq_agent_id` (`agent_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Single agent llmhub configuration';

-- 2. Drop organization LLM config table.
DROP TABLE IF EXISTS `t_organization_llmhubs_config`;

-- 3. Restore agent_id column in model registry.
ALTER TABLE `t_model_registry` ADD COLUMN `agent_id` varchar(128) NOT NULL DEFAULT '' COMMENT 'Agent scope owner, empty for global' AFTER `provider_template_type`;
ALTER TABLE `t_model_registry` ADD KEY `idx_agent_id` (`agent_id`);
ALTER TABLE `t_model_registry` DROP INDEX `idx_organization_id`;
ALTER TABLE `t_model_registry` DROP COLUMN `organization_id`;



-- Rollback Phase 2: Manage agents by organization + agent-scoped RBAC roles

-- 1. Remove seeded policy rules and any grouping rules referencing the new roles.
DELETE FROM `t_casbin_rule` WHERE `ptype` = 'p' AND `v0` IN ('developer', 'agent_editor');
DELETE FROM `t_casbin_rule` WHERE `ptype` = 'g' AND `v1` IN ('developer', 'agent_editor');

-- 2. Drop agent-scoped user_role rows (their UUID scope_id cannot be represented as
--    a bigint) before reverting the column type.
DELETE FROM `t_user_role` WHERE `scope_type` = 'agent';

-- 3. Revert t_user_role.scope_id back to bigint.
ALTER TABLE `t_user_role` MODIFY COLUMN `scope_id` bigint NOT NULL DEFAULT 0 COMMENT 'Organization or Project ID (0 for platform scope)';

-- 4. Drop organization_id / publish_status from t_single_agent.
ALTER TABLE `t_single_agent` DROP INDEX `idx_organization_id`;
ALTER TABLE `t_single_agent` DROP COLUMN `publish_status`;
ALTER TABLE `t_single_agent` DROP COLUMN `organization_id`;
