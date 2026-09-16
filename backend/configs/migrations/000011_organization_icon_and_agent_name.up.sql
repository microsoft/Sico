ALTER TABLE `t_organization`
    ADD COLUMN `icon_uri` varchar(255) NOT NULL DEFAULT '' COMMENT 'Organization icon URI' AFTER `description`;

SET @drop_uniq_name = IF(
    EXISTS(
        SELECT 1
        FROM `information_schema`.`statistics`
        WHERE `table_schema` = DATABASE()
          AND `table_name` = 't_single_agent'
          AND `index_name` = 'uniq_name'
    ),
    'ALTER TABLE `t_single_agent` DROP INDEX `uniq_name`',
    'SELECT 1'
);
PREPARE drop_uniq_name_stmt FROM @drop_uniq_name;
EXECUTE drop_uniq_name_stmt;
DEALLOCATE PREPARE drop_uniq_name_stmt;

SET @drop_uk_name = IF(
    EXISTS(
        SELECT 1
        FROM `information_schema`.`statistics`
        WHERE `table_schema` = DATABASE()
        AND `table_name` = 't_organization'
        AND `index_name` = 'uk_name'
    ),
    'ALTER TABLE `t_organization` DROP INDEX `uk_name`',
    'SELECT 1'
);
PREPARE drop_uk_name_stmt FROM @drop_uk_name;
EXECUTE drop_uk_name_stmt;
DEALLOCATE PREPARE drop_uk_name_stmt;
