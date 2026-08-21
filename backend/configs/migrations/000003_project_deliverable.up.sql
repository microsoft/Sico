-- --------------------------------------------------------------------------
-- Project deliverables table
-- --------------------------------------------------------------------------

CREATE TABLE `t_project_deliverable` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `project_id` bigint NOT NULL COMMENT 'Project ID',
    `file_name` varchar(512) NOT NULL DEFAULT '' COMMENT 'File name',
    `file_uri` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Internal file URI (blob path)',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `agent_instance_id` bigint NOT NULL DEFAULT 0 COMMENT 'Agent instance ID that produced this deliverable',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_project_deliverable_project` (`project_id`, `deleted_at`),
    KEY `idx_project_deliverable_agent_instance` (`agent_instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Project deliverables published from chat sessions';
