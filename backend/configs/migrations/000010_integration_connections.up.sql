CREATE TABLE `t_integration_connection` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'Primary key ID',
    `connection_key` varchar(64) COLLATE utf8mb4_bin NOT NULL COMMENT 'Stable public connection identifier',
    `organization_id` bigint NOT NULL COMMENT 'Owning Sico organization ID',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Owning Sico project; required for personal ADO connections',
    `owner_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Personal owner; empty for organization mode',
    `provider` varchar(64) COLLATE utf8mb4_bin NOT NULL COMMENT 'Connector key',
    `mode` tinyint unsigned NOT NULL COMMENT '1=personal, 2=organization',
    `status` tinyint unsigned NOT NULL DEFAULT 0 COMMENT 'Connection lifecycle status',
    `display_name` varchar(128) NOT NULL DEFAULT '' COMMENT 'User-visible connection name',
    `external_id` varchar(255) COLLATE utf8mb4_bin NOT NULL DEFAULT '' COMMENT 'Opaque provider-side connection identifier',
    `credential_version` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Current immutable credential version',
    `metadata` json NULL COMMENT 'Versioned non-secret connector metadata',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `updater_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Last updater username',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Creation time in Unix milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time in Unix milliseconds',
    `deleted_at` datetime NULL COMMENT 'Deletion time',
    `ado_personal_account_key` binary(32) GENERATED ALWAYS AS (
        CASE
            WHEN provider = 'azure_devops' AND mode = 1 AND deleted_at IS NULL
                AND JSON_TYPE(JSON_EXTRACT(metadata, '$.targetTenantId')) = 'STRING'
                AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.targetTenantId')) <> ''
                AND JSON_TYPE(JSON_EXTRACT(metadata, '$.profileId')) = 'STRING'
                AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.profileId')) <> ''
            THEN UNHEX(SHA2(CONCAT(
                LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.targetTenantId'))), '/',
                LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.profileId')))
            ), 256))
            ELSE NULL
        END
    ) STORED,
    `ado_entitlement_key` binary(32) GENERATED ALWAYS AS (
        CASE
            WHEN provider = 'azure_devops' AND mode = 2 AND deleted_at IS NULL
                AND JSON_TYPE(JSON_EXTRACT(metadata, '$.targetTenantId')) = 'STRING'
                AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.targetTenantId')) <> ''
                AND JSON_TYPE(JSON_EXTRACT(metadata, '$.targetServicePrincipalObjectId')) = 'STRING'
                AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.targetServicePrincipalObjectId')) <> ''
                AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.externalOrganizationName')) <> ''
            THEN UNHEX(SHA2(CONCAT(
                LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.targetTenantId'))), '/',
                LOWER(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.targetServicePrincipalObjectId'))), '/',
                LOWER(CASE
                    WHEN JSON_TYPE(JSON_EXTRACT(metadata, '$.externalOrganizationId')) = 'STRING'
                    THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.externalOrganizationId')), '')
                    ELSE NULLIF(external_id, '')
                END)
            ), 256))
            ELSE NULL
        END
    ) STORED,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_integration_connection_key` (`connection_key`),
    UNIQUE KEY `uk_integration_personal_account` (`project_id`, `owner_username`, `ado_personal_account_key`),
    UNIQUE KEY `uniq_integration_ado_entitlement` (`ado_entitlement_key`),
    CONSTRAINT `chk_integration_personal_project` CHECK (provider <> 'azure_devops' OR mode <> 1 OR project_id > 0),
    KEY `idx_integration_connection_project` (`project_id`, `provider`, `status`),
    KEY `idx_integration_connection_org_provider` (`organization_id`, `provider`, `status`),
    KEY `idx_integration_connection_owner` (`organization_id`, `owner_username`, `status`),
    KEY `idx_integration_connection_external` (`provider`, `external_id`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='External provider connections';

CREATE TABLE `t_integration_binding` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'Primary key ID',
    `connection_id` bigint unsigned NOT NULL COMMENT 'Integration connection ID',
    `sico_scope_type` tinyint unsigned NOT NULL COMMENT '1=organization, 2=project',
    `sico_scope_id` varchar(64) COLLATE utf8mb4_bin NOT NULL COMMENT 'Sico RBAC scope identifier',
    `resource_type` varchar(64) COLLATE utf8mb4_bin NOT NULL COMMENT 'Connector-defined resource kind',
    `resource_key` varchar(255) COLLATE utf8mb4_bin NOT NULL COMMENT 'Opaque canonical provider resource identifier',
    `resource_name` varchar(255) NOT NULL DEFAULT '' COMMENT 'Provider resource display name',
    `status` tinyint unsigned NOT NULL DEFAULT 1 COMMENT '1=active, 2=disabled, 3=inaccessible',
    `metadata` json NULL COMMENT 'Versioned non-secret connector metadata',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Creation time in Unix milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time in Unix milliseconds',
    `deleted_at` datetime NULL COMMENT 'Deletion time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_integration_binding_scope_resource` (
        `connection_id`,
        `sico_scope_type`,
        `sico_scope_id`,
        `resource_type`,
        `resource_key`
    ),
    KEY `idx_integration_binding_sico_scope` (`sico_scope_type`, `sico_scope_id`, `status`),
    KEY `idx_integration_binding_connection` (`connection_id`, `status`),
    KEY `idx_integration_binding_resource` (`resource_type`, `resource_key`, `status`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Sico scope to provider resource bindings';

CREATE TABLE `t_integration_credential` (
    `connection_id` bigint unsigned NOT NULL COMMENT 'Integration connection ID',
    `version` bigint unsigned NOT NULL COMMENT 'Immutable credential version',
    `scheme` varchar(64) COLLATE utf8mb4_bin NOT NULL COMMENT 'Envelope encryption scheme and version',
    `key_id` varchar(512) COLLATE utf8mb4_bin NOT NULL COMMENT 'Non-secret root key identifier and version',
    `encrypted_data` mediumblob NOT NULL COMMENT 'Encrypted credential envelope',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Creation time in Unix milliseconds',
    PRIMARY KEY (`connection_id`, `version`),
    KEY `idx_integration_credential_created_at` (`created_at`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable encrypted provider credential versions';

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
SELECT 'p', 'org_admin', '*', 'integration', 'manage'
WHERE NOT EXISTS (
        SELECT 1 FROM `t_casbin_rule`
        WHERE `ptype` = 'p' AND `v0` = 'org_admin' AND `v1` = '*'
            AND `v2` = 'integration' AND `v3` = 'manage'
);

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
SELECT 'p', 'org_admin', '*', 'integration', 'use'
WHERE NOT EXISTS (
        SELECT 1 FROM `t_casbin_rule`
        WHERE `ptype` = 'p' AND `v0` = 'org_admin' AND `v1` = '*'
            AND `v2` = 'integration' AND `v3` = 'use'
);

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
SELECT 'p', 'org_member', '*', 'integration', 'use'
WHERE NOT EXISTS (
        SELECT 1 FROM `t_casbin_rule`
        WHERE `ptype` = 'p' AND `v0` = 'org_member' AND `v1` = '*'
            AND `v2` = 'integration' AND `v3` = 'use'
);

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
SELECT 'p', 'project_admin', '*', 'integration', 'bind'
WHERE NOT EXISTS (
        SELECT 1 FROM `t_casbin_rule`
        WHERE `ptype` = 'p' AND `v0` = 'project_admin' AND `v1` = '*'
            AND `v2` = 'integration' AND `v3` = 'bind'
);

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
SELECT 'p', 'project_admin', '*', 'integration', 'use'
WHERE NOT EXISTS (
        SELECT 1 FROM `t_casbin_rule`
        WHERE `ptype` = 'p' AND `v0` = 'project_admin' AND `v1` = '*'
            AND `v2` = 'integration' AND `v3` = 'use'
);

INSERT INTO `t_casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`)
SELECT 'p', 'project_member', '*', 'integration', 'use'
WHERE NOT EXISTS (
        SELECT 1 FROM `t_casbin_rule`
        WHERE `ptype` = 'p' AND `v0` = 'project_member' AND `v1` = '*'
            AND `v2` = 'integration' AND `v3` = 'use'
);
