ALTER TABLE `t_notification`
    DROP INDEX `idx_notification_receiver_org_created`,
    DROP INDEX `idx_notification_project_org_created`,
    DROP COLUMN `organization_id`;
