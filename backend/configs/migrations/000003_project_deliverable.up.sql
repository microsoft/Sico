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

-- --------------------------------------------------------------------------
-- Project deliverables table
-- --------------------------------------------------------------------------

CREATE TABLE `t_project_deliverable` (
    `id` bigint NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
    `project_id` bigint NOT NULL COMMENT 'Project ID',
    `file_name` varchar(512) NOT NULL DEFAULT '' COMMENT 'File name',
    `file_uri` varchar(1024) NOT NULL DEFAULT '' COMMENT 'Internal file URI (blob path)',
    `creator_username` varchar(128) NOT NULL DEFAULT '' COMMENT 'Creator username',
    `agent_instance_id` bigint NOT NULL DEFAULT 0 COMMENT 'Agent instance ID that produced this deliverable',
    `created_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Create Time in Milliseconds',
    `updated_at` bigint unsigned NOT NULL DEFAULT 0 COMMENT 'Update Time in Milliseconds',
    `deleted_at` datetime NULL COMMENT 'Delete Time',
    PRIMARY KEY (`id`),
    KEY `idx_project_deliverable_project` (`project_id`, `deleted_at`),
    KEY `idx_project_deliverable_agent_instance` (`agent_instance_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Project deliverables published from chat sessions';
