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

-- --------------------------------------------------------------------------
-- Restore t_skill columns from t_skill_version, then drop t_skill_version
-- --------------------------------------------------------------------------

ALTER TABLE `t_skill`
    ADD COLUMN `asset_id` bigint NOT NULL DEFAULT 0 COMMENT 'Associated project asset ID' AFTER `description`,
    ADD COLUMN `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username' AFTER `asset_id`,
    ADD COLUMN `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Skill status: 0-UNKNOWN,1-UPLOADING,2-UPLOADED,3-FAILED' AFTER `creator_username`,
    ADD COLUMN `fail_reason` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Failure reason if status=FAILED' AFTER `status`;

UPDATE `t_skill` AS s
LEFT JOIN (
    SELECT v.*
    FROM `t_skill_version` AS v
    INNER JOIN (
        SELECT `skill_id`, MAX(`id`) AS `id`
        FROM `t_skill_version`
        GROUP BY `skill_id`
    ) AS latest ON latest.`id` = v.`id`
) AS latest_version ON latest_version.`skill_id` = s.`id`
SET
    s.`asset_id` = COALESCE(latest_version.`asset_id`, 0),
    s.`creator_username` = COALESCE(latest_version.`creator_username`, ''),
    s.`fail_reason` = COALESCE(latest_version.`fail_reason`, ''),
    s.`status` = COALESCE(latest_version.`status`, 0);

ALTER TABLE `t_skill`
    ADD KEY `idx_asset_id` (`asset_id`),
    ADD KEY `idx_status` (`status`);

DROP TABLE IF EXISTS `t_skill_version`;

-- --------------------------------------------------------------------------
-- Drop message recovery key
-- --------------------------------------------------------------------------

ALTER TABLE `t_message`
	DROP INDEX `uniq_message_task_runtime_recovery`,
	DROP COLUMN `task_runtime_recovery_key`;

-- --------------------------------------------------------------------------
-- Drop task runtime tables
-- --------------------------------------------------------------------------

DROP TABLE IF EXISTS `t_task_runtime_run`;
DROP TABLE IF EXISTS `t_task_runtime_batch`;
