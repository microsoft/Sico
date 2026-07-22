-- Copyright (c) 2026 Sico Authors
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in
-- all copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.

-- Phase 1: RBAC domain model migration
-- Switches Casbin from flat (sub, obj, act) to domain-scoped (sub, dom, obj, act)

-- 1. Create t_organization table
CREATE TABLE IF NOT EXISTS `t_organization` (
    `id` bigint NOT NULL AUTO_INCREMENT,
    `name` varchar(256) NOT NULL,
    `description` text NOT NULL,
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0,
    `deleted_at` datetime NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Organization Table';

-- 2. Add organization_id to t_project
ALTER TABLE `t_project` ADD COLUMN `organization_id` bigint NOT NULL DEFAULT 0 COMMENT 'Organization ID' AFTER `id`;
ALTER TABLE `t_project` ADD KEY `idx_organization_id` (`organization_id`);

-- 3. Alter t_user_role: drop role_id, add role_code + scope columns
ALTER TABLE `t_user_role` DROP INDEX `idx_role_id`;
ALTER TABLE `t_user_role` DROP COLUMN `role_id`;
ALTER TABLE `t_user_role` ADD COLUMN `role_code` varchar(64) NOT NULL DEFAULT '' COMMENT 'Role code: platform_admin, org_admin, project_admin, project_member' AFTER `user_id`;
ALTER TABLE `t_user_role` ADD COLUMN `scope_type` varchar(32) NOT NULL DEFAULT '' COMMENT 'platform|org|project' AFTER `role_code`;
ALTER TABLE `t_user_role` ADD COLUMN `scope_id` bigint NOT NULL DEFAULT 0 COMMENT 'Organization or Project ID (0 for platform scope)' AFTER `scope_type`;
ALTER TABLE `t_user_role` ADD INDEX `idx_scope` (`scope_type`, `scope_id`);
ALTER TABLE `t_user_role` ADD INDEX `idx_role_code` (`role_code`);

-- 4. Drop t_role table
DROP TABLE IF EXISTS `t_role`;

-- 5. Wipe existing casbin rules and seed policy rules for domain model
DELETE FROM `t_casbin_rule`;

-- Seed p (policy) rules: role templates with domain = "*"
-- platform_admin
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'platform_admin', '*', 'organization', 'admin');

-- org_admin
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'org_admin', '*', 'organization', 'manage');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'org_admin', '*', 'project', 'create');

-- project_admin
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_admin', '*', 'project', 'create');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_admin', '*', 'project', 'manage');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_admin', '*', 'dw', 'manage');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_admin', '*', 'asset', 'manage');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_admin', '*', 'dw', 'use');

-- project_member
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_member', '*', 'project', 'create');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_member', '*', 'dw', 'manage.own');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_member', '*', 'asset', 'manage.own');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_member', '*', 'dw', 'use');
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`) VALUES ('p', 'project_member', '*', 'dw', 'manage');

-- 6. Migrate t_project_user role_type=2 (admin) and role_type=3 (member) into t_user_role and casbin g rules
-- Look up user_id from t_user by username, insert into t_user_role with scope
INSERT INTO `t_user_role` (`user_id`, `role_code`, `scope_type`, `scope_id`, `created_at`, `updated_at`)
SELECT u.id,
       CASE pu.role_type WHEN 2 THEN 'project_admin' WHEN 3 THEN 'project_member' END,
       'project',
       pu.project_id,
       pu.created_at,
       pu.updated_at
FROM `t_project_user` pu
JOIN `t_user` u ON u.username = pu.username AND u.deleted_at IS NULL
JOIN `t_project` p ON p.id = pu.project_id AND p.deleted_at IS NULL
WHERE pu.role_type IN (2, 3)
  AND pu.deleted_at IS NULL;

-- Insert corresponding casbin g rules: g, username, role, project:<id>
INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`)
SELECT 'g',
       pu.username,
       CASE pu.role_type WHEN 2 THEN 'project_admin' WHEN 3 THEN 'project_member' END,
       CONCAT('project:', pu.project_id)
FROM `t_project_user` pu
JOIN `t_user` u ON u.username = pu.username AND u.deleted_at IS NULL
JOIN `t_project` p ON p.id = pu.project_id AND p.deleted_at IS NULL
WHERE pu.role_type IN (2, 3)
  AND pu.deleted_at IS NULL;


ALTER TABLE `t_single_agent_instance` ADD COLUMN `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Instance Status' AFTER `permission`;
