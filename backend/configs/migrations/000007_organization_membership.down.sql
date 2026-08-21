DELETE FROM `t_casbin_rule`
WHERE (`ptype` = 'p' AND `v0` = 'org_member')
   OR (`ptype` = 'g' AND `v1` = 'org_member');

DELETE FROM `t_user_role` WHERE `role_code` = 'org_member';

ALTER TABLE `t_organization`
    DROP INDEX `idx_creator_username`,
    DROP COLUMN `creator_username`;
