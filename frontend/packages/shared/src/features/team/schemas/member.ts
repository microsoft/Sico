import { z } from "zod";

import { rbacUserSchema, RoleCodeSchema } from "../../rbac";

// A project member = an RBAC user tagged with the role that placed them on the
// project. Built by merging the two `role_users` listings (admins + members)
// in `fetchProjectMembers`; `roleCode` is the resolved role after dedup (a user
// granted both roles collapses to the higher one, `project_admin`). Extends
// `rbacUserSchema` to keep one source of truth for the user fields (incl. its
// `.email()` validation).
export const projectMemberSchema = rbacUserSchema.extend({
  roleCode: RoleCodeSchema,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;
