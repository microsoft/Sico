-- Phase 2: Manage agents by organization + agent-scoped RBAC roles
-- Adds organization ownership to agents and introduces the developer / agent_editor
-- roles. Also widens t_user_role.scope_id to a string so agent-scoped assignments
-- can reference an agent by its UUID.

-- 1. Add organization_id / publish_status to t_single_agent (0 = platform-predefined agents).
ALTER TABLE `t_single_agent` ADD COLUMN `organization_id` bigint NOT NULL DEFAULT 0 COMMENT 'Organization ID (0 = platform-predefined)' AFTER `agent_id`;
ALTER TABLE `t_single_agent` ADD COLUMN `publish_status` bigint NOT NULL DEFAULT 0 COMMENT 'Publish status' AFTER `agent_id`;
ALTER TABLE `t_single_agent` ADD KEY `idx_organization_id` (`organization_id`);
UPDATE `t_single_agent` SET `publish_status` = 1 WHERE `organization_id` = 0;

-- 2. Widen t_user_role.scope_id to VARCHAR so it can hold either a numeric ID
--    (org/project) or an agent UUID. Existing numeric values convert to their
--    string representation automatically.
ALTER TABLE `t_user_role` MODIFY COLUMN `scope_id` varchar(64) NOT NULL DEFAULT '0' COMMENT 'Scope identifier: org/project numeric ID or agent UUID (0 for platform scope)';

-- 3. Seed policy (p) rules for the new roles (domain = "*").
-- developer: can enter the developer interface and create agents within an organization.
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'developer', '*', 'sicodev', 'entry');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'developer', '*', 'agent', 'create');

-- agent_editor: can manage a specific agent (scoped by agent UUID).
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'agent_editor', '*', 'agent', 'manage');

-- Phase 2: Replace agent-level LLM config with organization-level LLM config.

-- 1. Replace agent_id with organization_id in model registry.
ALTER TABLE `t_model_registry` ADD COLUMN `organization_id` bigint NOT NULL DEFAULT 0 COMMENT 'Organization scope owner, 0 for global' AFTER `provider_template_type`;
ALTER TABLE `t_model_registry` ADD KEY `idx_organization_id` (`organization_id`);
ALTER TABLE `t_model_registry` DROP INDEX `idx_agent_id`;
ALTER TABLE `t_model_registry` DROP COLUMN `agent_id`;

-- 2. Create organization LLM config table.
CREATE TABLE `t_organization_llmhubs_config` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key id',
    `organization_id` bigint NOT NULL COMMENT 'Organization ID',
    `default_model_key` varchar(128) NOT NULL DEFAULT '' COMMENT 'Default model key for the organization',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE KEY `uniq_organization_id` (`organization_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Organization llmhub configuration';

-- 3. Drop agent-level LLM config table.
DROP TABLE IF EXISTS `t_single_agent_llmhubs_config`;
