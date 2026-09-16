ALTER TABLE `t_organization`
    ADD UNIQUE INDEX `uk_name` (`name`);

ALTER TABLE `t_single_agent`
    ADD UNIQUE INDEX `uniq_name` (`name` ASC) USING BTREE;

ALTER TABLE `t_organization`
    DROP COLUMN `icon_uri`;
