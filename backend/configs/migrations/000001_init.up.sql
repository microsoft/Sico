-- Copyright (c) 2026 Sico Authors
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in
-- all copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.

-- ========================
-- Project
-- ========================

CREATE TABLE `t_project` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary Key ID',
    `owner_username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0' COMMENT 'Owner Username',
    `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'Project Name',
    `description` varchar(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'Project Description',
    `icon_uri` varchar(255) NOT NULL DEFAULT '' COMMENT 'Project icon URI',
    `creator_username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0' COMMENT 'Creator Username',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Creation Time (Milliseconds)',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time (Milliseconds)',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_creator_username`(`creator_username` ASC) USING BTREE,
    INDEX `idx_owner_username`(`owner_username` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Project Table';

CREATE TABLE `t_project_user` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary Key ID, Auto Increment',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Project ID',
    `username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0' COMMENT 'Username',
    `role_type` tinyint NOT NULL DEFAULT 3 COMMENT 'Role Type: 1.owner 2.admin 3.member',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Creation Time (Milliseconds)',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time (Milliseconds)',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uniq_project_username_role`(`project_id`, `username`, `role_type`) USING BTREE,
    INDEX `idx_username`(`username` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Project Member Table';

CREATE TABLE `t_project_asset` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary Key ID',
    `project_id` varchar(128) NOT NULL DEFAULT 'default_space' COMMENT 'Project ID',
    `object_key` varchar(128) NOT NULL DEFAULT '' COMMENT 'Object Key',
    `creator_username` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0' COMMENT 'Publisher Username',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    `extra` json NULL COMMENT 'Extended fields',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_project_id`(`project_id` ASC) USING BTREE,
    INDEX `idx_creator_username`(`creator_username` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Project Asset';

-- ========================
-- Agent
-- ========================

CREATE TABLE `t_single_agent` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary Key ID',
    `agent_id` varchar(128) NOT NULL DEFAULT '0' COMMENT 'Agent ID',
    `creator_username` varchar(128) NOT NULL DEFAULT '0' COMMENT 'Creator Username',
    `updater_username` varchar(128) NOT NULL DEFAULT '0' COMMENT 'Updater Username',
    `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'Agent Name',
    `role` varchar(128) NOT NULL DEFAULT '' COMMENT 'Agent Role',
    `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Agent Description',
    `icon_uri` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Icon URI',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uniq_agent_id`(`agent_id` ASC) USING BTREE,
    UNIQUE INDEX `uniq_name`(`name` ASC) USING BTREE,
    INDEX `idx_creator_username`(`creator_username` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Single Agent Table';

CREATE TABLE `t_single_agent_instance` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary Key ID',
    `agent_id` varchar(128) NOT NULL DEFAULT '0' COMMENT 'Agent ID',
    `employer_username` varchar(128) NOT NULL DEFAULT '0' COMMENT 'Employer Username',
    `operator_username` varchar(128) NOT NULL DEFAULT '0' COMMENT 'Operator Username',
    `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent Instance Name',
    `role` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent Role',
    `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT 'Agent Instance Description',
    `icon_uri` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Icon URI',
    `employer_icon_uri` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Employer Icon URI',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'the project id this agent instance belongs to',
    `permission` json NULL COMMENT 'Agent Permission Configuration',
    `attachments` json NULL COMMENT 'Form Attachments',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_agent_id`(`agent_id` ASC) USING BTREE,
    INDEX `idx_employer_username`(`employer_username` ASC) USING BTREE,
    INDEX `idx_operator_username`(`operator_username` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'Single Agent Instance Table';

-- ========================
-- Conversation
-- ========================

CREATE TABLE `t_conversation` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'Primary key ID',
    `agent_id` varchar(256) NOT NULL DEFAULT '' COMMENT 'Agent ID',
    `agent_instance_id` bigint NOT NULL DEFAULT 0 COMMENT 'Agent instance ID',
    `title` varchar(256) NOT NULL DEFAULT '' COMMENT 'Conversation title',
    `creator_username` varchar(128) NULL DEFAULT '0' COMMENT 'Creator Username',
    `ext` text NULL COMMENT 'Extension fields',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Creation time',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time',
    `deleted_at` datetime NULL COMMENT 'Deletion time',
    PRIMARY KEY (`id`),
    INDEX `idx_agent_id` (`agent_id`),
    INDEX `idx_agent_id_agent_instance_id_creator_username` (`agent_id`, `agent_instance_id`, `creator_username`),
    INDEX `idx_agent_instance_id_creator_username` (`agent_instance_id`, `creator_username`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Conversation info';

CREATE TABLE `t_message` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT 'Primary key ID',
    `turn_id` bigint NOT NULL DEFAULT 0 COMMENT 'Id of a conversation turn',
    `conversation_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Conversation ID',
    `username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Username',
    `agent_instance_id` bigint NOT NULL DEFAULT 0 COMMENT 'Agent instance ID',
    `role` varchar(128) NOT NULL DEFAULT '' COMMENT 'Role: user, assistant, system',
    `content_type` tinyint unsigned NOT NULL COMMENT 'Content type (0=unknown, 1=text, 2=function_call, 3=function_result, 4=attachment)',
    `content` mediumtext NULL COMMENT 'Content',
    `function_context` json NULL COMMENT 'Function call/result context',
    `ext` text NULL COMMENT 'Message extension fields',
    `attachments` json NULL COMMENT 'Message attachments',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Creation time',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time',
    PRIMARY KEY (`id`),
    KEY `idx_message_username_agent_instance` (`username`, `agent_instance_id`)
) ENGINE=InnoDB CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Messages';

-- ========================
-- RBAC
-- ========================

CREATE TABLE `t_user` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary Key',
    `alias` varchar(64) NOT NULL DEFAULT '' COMMENT 'Name of user',
    `username` varchar(64) NOT NULL DEFAULT '' COMMENT 'Username for login',
    `password` varchar(255) NOT NULL DEFAULT '' COMMENT 'Password for login (MD5 hashed)',
    `email` varchar(255) NOT NULL DEFAULT '' COMMENT 'Email address',
    `tenant` varchar(255) NOT NULL DEFAULT 'PUBLIC' COMMENT 'Tenant',
    `phone` varchar(32) NOT NULL DEFAULT '' COMMENT 'Phone number',
    `icon_uri` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Icon URI',
    `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Status of user (inactive, active, freeze)',
    `description` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Description',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE INDEX `uniq_username`(`username`) USING BTREE,
    INDEX `idx_alias`(`alias`) USING BTREE,
    INDEX `idx_username`(`username`) USING BTREE,
    INDEX `idx_email`(`email`) USING BTREE,
    INDEX `idx_phone`(`phone`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'User Table';

CREATE TABLE `t_role` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `description` VARCHAR(512) NOT NULL DEFAULT '',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '1=enabled,0=disabled',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time (Unix timestamp)',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time (Unix timestamp)',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_role_code` (`code`),
    KEY `idx_role_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Roles';

CREATE TABLE `t_user_role` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary Key',
    `user_id` bigint NOT NULL DEFAULT 0 COMMENT 'From User.ID',
    `role_id` bigint NOT NULL DEFAULT 0 COMMENT 'From Role.ID',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`) USING BTREE,
    INDEX `idx_user_id`(`user_id`) USING BTREE,
    INDEX `idx_role_id`(`role_id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'User roles for RBAC';

CREATE TABLE `t_casbin_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ptype` VARCHAR(16) NOT NULL,
    `v0` VARCHAR(128) NOT NULL DEFAULT '',
    `v1` VARCHAR(128) NOT NULL DEFAULT '',
    `v2` VARCHAR(128) NOT NULL DEFAULT '',
    `v3` VARCHAR(128) NOT NULL DEFAULT '',
    `v4` VARCHAR(128) NOT NULL DEFAULT '',
    `v5` VARCHAR(128) NOT NULL DEFAULT '',
    PRIMARY KEY (`id`),
    KEY `idx_ptype_v0` (`ptype`, `v0`),
    KEY `idx_ptype_v1` (`ptype`, `v1`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Casbin policy storage';

-- ========================
-- Knowledge
-- ========================

CREATE TABLE `t_knowledge_document` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Project ID',
    `agent_id` varchar(256) NOT NULL DEFAULT '' COMMENT 'Agent ID (references t_single_agent.agent_id)',
    `asset_id` bigint NOT NULL DEFAULT 0 COMMENT 'Associated project asset ID',
    `name` varchar(256) NOT NULL DEFAULT '' COMMENT 'Document name',
    `icon_uri` varchar(256) NOT NULL DEFAULT '' COMMENT 'Icon URI',
    `link_url` varchar(2048) NOT NULL DEFAULT '' COMMENT 'Optional external link URL',
    `document_type` tinyint NOT NULL DEFAULT 0 COMMENT 'Document type: 0-UNKNOWN,1-FILE,2-LINK',
    `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Document status: 0-UNKNOWN,1-FAILED,2-UPLOADED,3-INGESTED',
    `fail_reason` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Failure reason if status=FAILED',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_project_id` (`project_id`),
    KEY `idx_asset_id` (`asset_id`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Knowledge document table';

CREATE TABLE `t_knowledge_tag` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Project ID',
    `name` varchar(256) NOT NULL DEFAULT '' COMMENT 'Tag name',
    `description` text NOT NULL COMMENT 'Description',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_project_id` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Knowledge tag table';

CREATE TABLE `t_knowledge_document_tag` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `knowledge_document_id` bigint NOT NULL COMMENT 'Knowledge document ID',
    `knowledge_tag_id` bigint NOT NULL COMMENT 'Knowledge tag ID',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_document_id` (`knowledge_document_id`),
    KEY `idx_tag_id` (`knowledge_tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Knowledge document to tag mapping table';

CREATE TABLE `t_knowledge_playbook` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Project ID',
    `agent_instance_id` bigint NOT NULL DEFAULT 0 COMMENT 'Agent instance ID',
    `name` varchar(256) NOT NULL DEFAULT '' COMMENT 'Playbook name',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_project_id` (`project_id`),
    KEY `idx_agent_instance_id` (`agent_instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Playbook table';

CREATE TABLE `t_knowledge_playbook_tag` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `knowledge_playbook_id` bigint NOT NULL COMMENT 'Knowledge playbook ID',
    `knowledge_tag_id` bigint NOT NULL COMMENT 'Knowledge tag ID',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_playbook_id` (`knowledge_playbook_id`),
    KEY `idx_tag_id` (`knowledge_tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Playbook tag relation table';

-- ========================
-- LLM
-- ========================

CREATE TABLE `t_llm_generation_record` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `input_messages` json NOT NULL COMMENT 'Prompts when triggering generation',
    `model` varchar(128) NOT NULL DEFAULT '' COMMENT 'Model used for generation',
    `response_format` text NOT NULL COMMENT 'Response format',
    `output_text` text NOT NULL COMMENT 'Generation output text',
    `output_payload` json NULL COMMENT 'Generation output payload',
    `node_execution_id` bigint NOT NULL COMMENT 'Node Execution ID',
    `extra_info` json NOT NULL COMMENT 'additional information',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Creation time (Unix timestamp)',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time (Unix timestamp)',
    PRIMARY KEY (`id`),
    KEY `idx_node_execution_id` (`node_execution_id`),
    KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='LLM Generation Record Table';

-- ========================
-- Skill
-- ========================

CREATE TABLE `t_skill` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `project_id` bigint NOT NULL DEFAULT 0 COMMENT 'Project ID',
    `agent_id` varchar(256) NOT NULL DEFAULT '' COMMENT 'Agent ID (references t_single_agent.agent_id)',
    `name` varchar(256) NOT NULL DEFAULT '' COMMENT 'Skill name',
    `description` text NOT NULL COMMENT 'Skill description',
    `asset_id` bigint NOT NULL DEFAULT 0 COMMENT 'Associated project asset ID',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `status` tinyint NOT NULL DEFAULT 0 COMMENT 'Skill status: 0-UNKNOWN,1-UPLOADING,2-UPLOADED,3-FAILED',
    `fail_reason` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Failure reason if status=FAILED',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_project_id` (`project_id`),
    KEY `idx_agent_id` (`agent_id`),
    KEY `idx_asset_id` (`asset_id`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Skill table';

-- ========================
-- LLMHub Model Registry
-- ========================

CREATE TABLE `t_model_registry` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `model_key` varchar(128) NOT NULL COMMENT 'System-generated immutable runtime key',
    `display_name` varchar(255) NOT NULL COMMENT 'User-facing model name',
    `model_type` tinyint NOT NULL COMMENT '1=text, 2=multimodal, 3=artifact',
    `provider_template_type` tinyint NOT NULL COMMENT '1=azure_openai, 2=openai_compatible, 4=http_json, 5=http_binary, 6=anthropic, 7=gemini',
    `agent_id` varchar(128) NOT NULL DEFAULT '' COMMENT 'Agent scope owner, empty for global',
    `status` tinyint NOT NULL DEFAULT 1 COMMENT '1=active, 2=disabled',
    `is_builtin` tinyint NOT NULL DEFAULT 0 COMMENT '0=custom, 1=builtin',
    `description` text NULL COMMENT 'Model description',
    `icon_uri` varchar(255) NOT NULL DEFAULT '' COMMENT 'Model icon URI',
    `io_profile` json NULL COMMENT 'Generated I/O profile from model_type',
    `config` json NULL COMMENT 'Runtime config: endpoint, auth, mapping rules',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator',
    `updater_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Last updater',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_model_key` (`model_key`),
    KEY `idx_agent_id` (`agent_id`),
    KEY `idx_provider_template_type` (`provider_template_type`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='LLMHub model registry';

CREATE TABLE `t_model_registry_secret` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `model_registry_id` bigint NOT NULL COMMENT 'FK to t_model_registry',
    `secret_key` varchar(128) NOT NULL COMMENT 'Secret identifier, e.g. bearer_token, api_key',
    `secret_value` text NULL COMMENT 'Encrypted secret value',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    PRIMARY KEY (`id`),
    KEY `idx_model_registry_id` (`model_registry_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Model registry secrets storage';

CREATE TABLE `t_single_agent_llmhubs_config` (
    `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Primary key id',
    `agent_id` varchar(128) NOT NULL COMMENT 'Agent ID',
    `model_keys` json NULL COMMENT 'Selected llmhub model keys',
    `default_global_model_key` varchar(128) NOT NULL DEFAULT '' COMMENT 'Default global llmhub model key',
    `created_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Create time in milliseconds',
    `updated_at` bigint UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Update time in milliseconds',
    PRIMARY KEY (`id`) USING BTREE,
    UNIQUE KEY `uniq_agent_id` (`agent_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Single agent llmhub configuration';
