CREATE TABLE `t_organization_invitation` (
    `id`                  bigint       NOT NULL AUTO_INCREMENT,
    `organization_id`     bigint       NOT NULL COMMENT 'Organization ID',
    `token_hash`          char(64)     NOT NULL COMMENT 'SHA-256 hash of the invitation token',
    `created_by_username` varchar(256) NOT NULL COMMENT 'Username that created the invitation',
    `expires_at`          bigint       NOT NULL COMMENT 'Expiration time in Unix milliseconds',
    `revoked_at`          bigint       NOT NULL DEFAULT 0 COMMENT 'Revocation time in Unix milliseconds; 0 means active',
    `created_at`          bigint       NOT NULL,
    `updated_at`          bigint       NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_token_hash` (`token_hash`),
    KEY `idx_organization_id` (`organization_id`),
    KEY `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Organization invitation links';
