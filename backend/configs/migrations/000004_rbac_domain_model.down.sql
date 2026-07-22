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

ALTER TABLE `t_single_agent_instance` DROP COLUMN `status`;

-- Rollback Phase 1: RBAC domain model migration

-- Remove migrated casbin g rules and user_role entries for project users
-- (Cannot precisely identify migrated rows, so we clear all g rules and re-seed would be needed)

-- Wipe all casbin rules (will need re-seeding of old flat model rules)
DELETE FROM `t_casbin_rule`;

-- Remove scope columns and restore role_id on t_user_role
ALTER TABLE `t_user_role` DROP INDEX `idx_role_code`;
ALTER TABLE `t_user_role` DROP INDEX `idx_scope`;
ALTER TABLE `t_user_role` DROP COLUMN `scope_id`;
ALTER TABLE `t_user_role` DROP COLUMN `scope_type`;
ALTER TABLE `t_user_role` DROP COLUMN `role_code`;
ALTER TABLE `t_user_role` ADD COLUMN `role_id` bigint NOT NULL DEFAULT 0 COMMENT 'From Role.ID' AFTER `user_id`;
ALTER TABLE `t_user_role` ADD INDEX `idx_role_id` (`role_id`);

-- Recreate t_role table
CREATE TABLE `t_role` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` varchar(64) NOT NULL,
    `name` varchar(128) NOT NULL,
    `description` varchar(512) NOT NULL DEFAULT '',
    `status` tinyint NOT NULL DEFAULT 1 COMMENT '1=enabled, 0=disabled',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0,
    `deleted_at` datetime NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_role_code` (`code`),
    KEY `idx_role_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Remove organization_id from t_project
ALTER TABLE `t_project` DROP INDEX `idx_organization_id`;
ALTER TABLE `t_project` DROP COLUMN `organization_id`;

-- Drop t_organization table
DROP TABLE IF EXISTS `t_organization`;
