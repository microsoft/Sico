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
-- Task runtime tables
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `t_task_runtime_batch` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key ID',
    `batch_id` varchar(64) NOT NULL COMMENT 'Task runtime batch ID',
    `parent_conversation_id` bigint NOT NULL DEFAULT 0 COMMENT 'Parent conversation ID',
    `parent_turn_id` bigint NOT NULL DEFAULT 0 COMMENT 'Parent turn ID',
    `parent_tool_call_id` bigint NULL COMMENT 'Parent plan tool call ID',
    `status` varchar(32) NOT NULL DEFAULT 'queued' COMMENT 'Batch status',
    `reason` varchar(2000) NOT NULL DEFAULT '' COMMENT 'Delegation reason',
    `join_strategy` varchar(32) NOT NULL DEFAULT 'partial_ok' COMMENT 'Batch join strategy',
    `total_count` int NOT NULL DEFAULT 0 COMMENT 'Number of runs in this batch',
    `counts_json` json NULL COMMENT 'Aggregated terminal counts',
    `batch_json` json NOT NULL COMMENT 'Full BatchRecord JSON payload',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    `liveness_at` bigint UNSIGNED NULL COMMENT 'Owner-process batch liveness heartbeat in milliseconds',
    `ended_at` bigint UNSIGNED NULL COMMENT 'End time in milliseconds',
    `cancellation_reason` varchar(2000) NOT NULL DEFAULT '' COMMENT 'Cancellation reason',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_task_runtime_batch_id` (`batch_id`),
    KEY `idx_task_runtime_batch_parent` (`parent_conversation_id`, `parent_turn_id`),
    KEY `idx_task_runtime_batch_status` (`status`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Task runtime batch metadata';

CREATE TABLE IF NOT EXISTS `t_task_runtime_run` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key ID',
    `run_id` varchar(64) NOT NULL COMMENT 'Task runtime run ID',
    `batch_id` varchar(64) NOT NULL COMMENT 'Task runtime batch ID',
    `parent_conversation_id` bigint NOT NULL DEFAULT 0 COMMENT 'Parent conversation ID',
    `parent_turn_id` bigint NOT NULL DEFAULT 0 COMMENT 'Parent turn ID',
    `batch_item_index` int NOT NULL DEFAULT 0 COMMENT 'Run index inside batch',
    `task_id` varchar(128) NOT NULL DEFAULT '' COMMENT 'LLM-visible task ID',
    `idempotency_key` varchar(128) NOT NULL DEFAULT '' COMMENT 'Canonical idempotency key',
    `status` varchar(32) NOT NULL DEFAULT 'queued' COMMENT 'Run status',
    `attempt` int NOT NULL DEFAULT 1 COMMENT 'Retry attempt number',
    `executor` varchar(64) NOT NULL DEFAULT '' COMMENT 'Executor backend',
    `worker_id` varchar(128) NOT NULL DEFAULT '' COMMENT 'Current worker ID',
    `fencing_token` varchar(128) NOT NULL DEFAULT '' COMMENT 'Current fencing token',
    `queued_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Queue time in milliseconds',
    `started_at` bigint UNSIGNED NULL COMMENT 'Start time in milliseconds',
    `ended_at` bigint UNSIGNED NULL COMMENT 'End time in milliseconds',
    `last_error_class` varchar(64) NOT NULL DEFAULT '' COMMENT 'Last structured error class',
    `last_error` mediumtext NOT NULL COMMENT 'Last error message',
    `run_json` json NOT NULL COMMENT 'Full TaskRun JSON payload',
    `result_json` json NULL COMMENT 'Full TaskResult JSON payload',
    `latest_progress_message` varchar(1000) NOT NULL DEFAULT '' COMMENT 'Latest run progress message',
    `latest_progress_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Latest progress timestamp in milliseconds',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_task_runtime_run_id` (`run_id`),
    KEY `idx_task_runtime_run_batch` (`batch_id`, `batch_item_index`),
    UNIQUE KEY `uniq_task_runtime_run_idempotency` (`idempotency_key`),
    KEY `idx_task_runtime_run_status` (`status`),
    KEY `idx_task_runtime_run_worker` (`worker_id`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Task runtime run metadata and result';

-- --------------------------------------------------------------------------
-- Message recovery key
-- --------------------------------------------------------------------------

ALTER TABLE `t_message`
    ADD COLUMN `task_runtime_recovery_key` varchar(191)
        GENERATED ALWAYS AS (
            CASE
                WHEN JSON_UNQUOTE(JSON_EXTRACT(`function_context`, '$.result')) LIKE 'task_runtime_recovery_batch:%'
                    THEN JSON_UNQUOTE(JSON_EXTRACT(`function_context`, '$.result'))
                ELSE NULL
            END
        ) STORED,
    ADD UNIQUE KEY `uniq_message_task_runtime_recovery` (
        `conversation_id`,
        `turn_id`,
        `username`,
        `agent_instance_id`,
        `role`,
        `content_type`,
        `task_runtime_recovery_key`
    );

-- --------------------------------------------------------------------------
-- Skill versions
-- --------------------------------------------------------------------------

CREATE TABLE `t_skill_version` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `skill_id` bigint NOT NULL COMMENT 'Skill ID',
    `version` varchar(32) NOT NULL DEFAULT '' COMMENT 'Timestamp version string',
    `asset_id` bigint NOT NULL DEFAULT 0 COMMENT 'Associated project asset ID',
    `name` varchar(256) NOT NULL DEFAULT '' COMMENT 'Skill version name',
    `description` text NOT NULL COMMENT 'Skill version description',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Version creator username',
    `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Skill version status: 0-UNKNOWN,1-UPLOADING,2-UPLOADED,3-FAILED',
    `fail_reason` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Failure reason if resolver failed',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_skill_version` (`skill_id`, `version`),
    KEY `idx_skill_version_latest` (`skill_id`, `created_at`),
    KEY `idx_skill_version_deleted` (`skill_id`, `deleted_at`),
    KEY `idx_skill_version_asset_id` (`asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Skill immutable version table';

INSERT INTO `t_skill_version` (
    `skill_id`,
    `version`,
    `asset_id`,
    `name`,
    `description`,
    `creator_username`,
    `status`,
    `fail_reason`,
    `created_at`,
    `updated_at`,
    `deleted_at`
)
SELECT
    `id`,
    CAST(CASE
        WHEN `created_at` > 0 THEN `created_at`
        WHEN `updated_at` > 0 THEN `updated_at`
        ELSE 1
    END AS CHAR),
    `asset_id`,
    `name`,
    `description`,
    `creator_username`,
    `status`,
    `fail_reason`,
    `created_at`,
    `updated_at`,
    `deleted_at`
FROM `t_skill`;

ALTER TABLE `t_skill`
    DROP INDEX `idx_asset_id`,
    DROP INDEX `idx_status`,
    DROP COLUMN `asset_id`,
    DROP COLUMN `creator_username`,
    DROP COLUMN `status`,
    DROP COLUMN `fail_reason`;
