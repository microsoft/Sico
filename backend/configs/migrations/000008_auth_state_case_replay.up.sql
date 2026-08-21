CREATE TABLE IF NOT EXISTS `t_auth_state` (
    `id`                bigint          NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `account_key`       varchar(256)    NOT NULL COMMENT 'Stable account/profile key, e.g. Mobileaitest01@outlook.com',
    `site_host`         varchar(128)    NOT NULL DEFAULT '' COMMENT 'Normalized host only (lowercased, no scheme/port), e.g. copilot.microsoft.com',
    `state_blob_path`   varchar(512)    NOT NULL DEFAULT '' COMMENT 'Container-relative blob path of storageState JSON (cookies+localStorage), e.g. auth-state/{hash}/storageState.json; CDN URL derived at read time',
    `status`            tinyint         NOT NULL DEFAULT 0 COMMENT 'Auth state status: 0-UNKNOWN,1-VALID,2-EXPIRED,3-DISABLED',
    `expires_at`        bigint          NOT NULL DEFAULT 0 COMMENT 'Earliest critical cookie expiry (ms) for proactive refresh; 0=unknown',
    `last_validated_at` bigint          NOT NULL DEFAULT 0 COMMENT 'Last successful validation (ms); 0=never',
    `metadata`          json            NULL COMMENT 'Optional: provider(MSA/AAD/Google), notes, account-pool tags; not used for matching',
    `created_at`        bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at`        bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at`        datetime        NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_account_site` (`account_key`, `site_host`),
    KEY `idx_status_expiry` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Reusable browser auth session (storageState) per account/site';

CREATE TABLE IF NOT EXISTS `t_case_replay` (
    `id`                bigint          NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `case_id`           varchar(64)     NOT NULL COMMENT 'Content-addressed case id: {logicalCaseId}-{sha256(caseId + canonical steps)[:16]}; a step-content change yields a new id so a stale replay is never reused',
    `site_host`         varchar(128)    NOT NULL DEFAULT '' COMMENT 'Normalized host only (lowercased, no scheme/port), e.g. copilot.microsoft.com',
    `platform`          varchar(32)     NOT NULL DEFAULT 'windows' COMMENT 'windows|macos; OS steps/window titles/coords are platform-specific, so platform is part of the case replay identity (one active version per platform)',
    `active_version_id` bigint          NOT NULL DEFAULT 0 COMMENT 'Currently active version id (t_case_replay_version.id); 0=none',
    `status`            tinyint         NOT NULL DEFAULT 0 COMMENT 'Case replay status: 0-UNKNOWN,1-ACTIVE,2-STALE,3-DISABLED',
    `created_at`        bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at`        bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at`        datetime        NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_case_site_platform` (`case_id`, `site_host`, `platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Logical case replay pointer (content-addressed, per platform)';

CREATE TABLE IF NOT EXISTS `t_case_replay_version` (
    `id`                bigint          NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `case_replay_id`    bigint          NOT NULL COMMENT 'Owning case replay pointer id (t_case_replay.id)',
    `version`           varchar(32)     NOT NULL DEFAULT '' COMMENT 'Timestamp version string (core-assigned, e.g. unix millis)',
    `actions_blob_path` varchar(512)    NOT NULL DEFAULT '' COMMENT 'Container-relative blob path of actions.json, e.g. case-replay/{case_replay_id}/{version_id}/actions.json; CDN URL derived at read time',
    `metadata`          json            NULL COMMENT 'Optional per-version info: site build, capture time, tier stats, heal counts, creator',
    `created_at`        bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at`        bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at`        datetime        NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_case_replay_version` (`case_replay_id`, `version`),
    KEY `idx_case_replay_created` (`case_replay_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable case replay action versions';
