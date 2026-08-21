ALTER TABLE `t_organization`
    ADD COLUMN `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username' AFTER `description`,
    ADD KEY `idx_creator_username` (`creator_username`);

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
VALUES ('p', 'org_member', '*', 'project', 'create');

START TRANSACTION;

INSERT INTO `t_user_role` (`user_id`, `role_code`, `scope_type`, `scope_id`, `created_at`, `updated_at`)
SELECT admin_role.`user_id`,
       CASE admin_role.`role_code`
           WHEN 'org_admin' THEN 'org_member'
           WHEN 'project_admin' THEN 'project_member'
       END,
       admin_role.`scope_type`,
       admin_role.`scope_id`,
  MIN(admin_role.`created_at`),
  MAX(admin_role.`updated_at`)
FROM `t_user_role` admin_role
JOIN `t_user` user
  ON user.`id` = admin_role.`user_id`
 AND user.`deleted_at` IS NULL
WHERE admin_role.`deleted_at` IS NULL
  AND ((admin_role.`role_code` = 'org_admin' AND admin_role.`scope_type` = 'org')
    OR (admin_role.`role_code` = 'project_admin' AND admin_role.`scope_type` = 'project'))
  AND NOT EXISTS (
      SELECT 1
      FROM `t_user_role` member_role
      WHERE member_role.`user_id` = admin_role.`user_id`
        AND member_role.`role_code` = CASE admin_role.`role_code`
            WHEN 'org_admin' THEN 'org_member'
            WHEN 'project_admin' THEN 'project_member'
        END
        AND member_role.`scope_type` = admin_role.`scope_type`
        AND member_role.`scope_id` = admin_role.`scope_id`
        AND member_role.`deleted_at` IS NULL
  )
GROUP BY admin_role.`user_id`, admin_role.`role_code`, admin_role.`scope_type`, admin_role.`scope_id`;

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`)
SELECT DISTINCT 'g',
       user.`username`,
       CASE admin_role.`role_code`
           WHEN 'org_admin' THEN 'org_member'
           WHEN 'project_admin' THEN 'project_member'
       END,
       CONCAT(admin_role.`scope_type`, ':', admin_role.`scope_id`)
FROM `t_user_role` admin_role
JOIN `t_user` user
  ON user.`id` = admin_role.`user_id`
 AND user.`deleted_at` IS NULL
WHERE admin_role.`deleted_at` IS NULL
  AND ((admin_role.`role_code` = 'org_admin' AND admin_role.`scope_type` = 'org')
    OR (admin_role.`role_code` = 'project_admin' AND admin_role.`scope_type` = 'project'))
  AND NOT EXISTS (
      SELECT 1
      FROM `t_casbin_rule` grouping_rule
      WHERE grouping_rule.`ptype` = 'g'
        AND grouping_rule.`v0` = user.`username`
        AND grouping_rule.`v1` = CASE admin_role.`role_code`
            WHEN 'org_admin' THEN 'org_member'
            WHEN 'project_admin' THEN 'project_member'
        END
        AND grouping_rule.`v2` = CONCAT(admin_role.`scope_type`, ':', admin_role.`scope_id`)
  );

COMMIT;
