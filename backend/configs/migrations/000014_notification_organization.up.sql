ALTER TABLE `t_notification`
    ADD COLUMN `organization_id` bigint NOT NULL DEFAULT 0 COMMENT 'Organization ID; 0 means unresolved' AFTER `project_id`,
    ADD KEY `idx_notification_receiver_org_created` (`receiver_username`, `organization_id`, `created_at`),
    ADD KEY `idx_notification_project_org_created` (`project_id`, `organization_id`, `created_at`);
