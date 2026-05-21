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

DROP TABLE IF EXISTS `t_single_agent_llmhubs_config`;
DROP TABLE IF EXISTS `t_model_registry_secret`;
DROP TABLE IF EXISTS `t_model_registry`;
DROP TABLE IF EXISTS `t_skill`;
DROP TABLE IF EXISTS `t_llm_generation_record`;
DROP TABLE IF EXISTS `t_knowledge_playbook_tag`;
DROP TABLE IF EXISTS `t_knowledge_playbook`;
DROP TABLE IF EXISTS `t_knowledge_document_tag`;
DROP TABLE IF EXISTS `t_knowledge_tag`;
DROP TABLE IF EXISTS `t_knowledge_document`;
DROP TABLE IF EXISTS `t_message`;
DROP TABLE IF EXISTS `t_conversation`;
DROP TABLE IF EXISTS `t_single_agent_instance`;
DROP TABLE IF EXISTS `t_single_agent`;
DROP TABLE IF EXISTS `t_casbin_rule`;
DROP TABLE IF EXISTS `t_user_role`;
DROP TABLE IF EXISTS `t_role`;
DROP TABLE IF EXISTS `t_user`;
DROP TABLE IF EXISTS `t_project_asset`;
DROP TABLE IF EXISTS `t_project_user`;
DROP TABLE IF EXISTS `t_project`;
