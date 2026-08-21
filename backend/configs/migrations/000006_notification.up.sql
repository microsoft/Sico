CREATE TABLE `t_notification` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary Key ID',
    `sender_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Sender Username',
    `receiver_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Receiver Username',
    `type` tinyint NOT NULL DEFAULT 0 COMMENT 'Notification type',
    `content` text NULL COMMENT 'Notification content',
    `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Notification status (unread, read)',
    `extra_info` json NULL COMMENT 'Extra information',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Project ID for project-scoped notifications',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time (Unix timestamp)',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time (Unix timestamp)',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_receiver_username` (`receiver_username`),
    KEY `idx_sender_username` (`sender_username`),
    KEY `idx_notification_project` (`project_id`, `deleted_at`)
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Notification Table';
