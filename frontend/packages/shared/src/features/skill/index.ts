/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export { SetupBasicInfo } from "./components/setup/setup-basic-info";
export { SetupSkeleton } from "./components/setup/setup-skeleton";
export { SetupSkillSection } from "./components/setup/setup-skill-section";
export { SETUP_SKILLS_PAGE_SIZE } from "./constants";

export { type Role, roleSchema, rolesPayloadSchema } from "./schemas/roles";
export {
  type SkillDetail,
  type SkillItem,
  type SkillStatus,
  type SkillVersion,
  SkillStatusSchema,
  skillDetailSchema,
  skillItemSchema,
} from "./schemas/skill";

export {
  useSkillsQuery,
  useSkillsSuspenseQuery,
  useSkillsSuspenseInfiniteQuery,
  skillsQueryOptions,
  skillsInfiniteQueryOptions,
} from "./hooks/use-skills-query";
export {
  useSkillDetailQuery,
  skillDetailQueryOptions,
} from "./hooks/use-skill-detail-query";
export { useSkillStatusQuery } from "./hooks/use-skill-status-query";
export {
  useRolesQuery,
  useRolesSuspenseQuery,
  rolesQueryOptions,
} from "./hooks/use-roles-query";
export {
  useCreateSkillMutation,
  useUpdateSkillMutation,
  useDeleteSkillMutation,
  useUploadSkillAssetMutation,
  useUploadSkills,
} from "./hooks/use-skill-mutations";
