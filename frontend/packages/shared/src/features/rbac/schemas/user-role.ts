import { z } from "zod";

// Closed set of RBAC role codes that cross the API boundary — PascalCase enum
// schema is the single source of truth (schemas.md closed-enum exception).
export const RoleCodeSchema = z.enum(["project_admin", "project_member"]);
export type RoleCode = z.infer<typeof RoleCodeSchema>;

// Short members-context labels (the Team table + invite dialog): project_admin →
// "Admin", project_member → "Member".
export const MEMBER_ROLE_LABELS: Record<RoleCode, string> = {
  project_admin: "Admin",
  project_member: "Member",
};

// A user summary as embedded in RBAC responses. `alias`/`iconUri` are optional
// display fields the backend may omit or send empty.
export const rbacUserSchema = z.object({
  id: z.number().int(),
  email: z.string().email(),
  alias: z.string().optional(),
  iconUri: z.string().optional(),
  // Per-user last-touch time; the Team table's LAST ACTIVE reads this so each
  // row shows the member's own time instead of the shared project fallback.
  // Backend sends epoch SECONDS here (vs project detail's ms) — the formatter
  // normalizes by magnitude. Optional: absent for a member → row falls back.
  updatedAt: z.number().int().optional(),
});
export type RbacUser = z.infer<typeof rbacUserSchema>;

// A single role grant: a role code scoped to a resource (`scopeType`+`scopeId`)
// for a user. `roleCode` is a bare string, NOT `RoleCodeSchema`: a user's role
// list spans every scope (platform/org/project) and carries codes we don't
// model (`platform_admin`, `org_admin`, `""`), so narrowing here would reject
// the whole list. Callers match the project codes by string. `scopeType`/
// `scopeId` are tolerated (default `""`/`0`) for the same reason — a non-project
// grant that omits them must not nuke the whole list. `scopeId` arrives as a
// STRING on the wire (e.g. `"80"`); `z.coerce` turns it into the number that
// `projectRoleFor` compares against `projectId` — a plain `z.number()` failed
// the string and `.catch(0)` silently zeroed EVERY grant, dropping all project
// permissions. The embedded `user` is present on `user_roles` listings but may
// be `null`.
export const userRoleSchema = z.object({
  roleCode: z.string(),
  scopeType: z.string().catch(""),
  scopeId: z.coerce.number().int().catch(0),
  userId: z.number().int(),
  user: rbacUserSchema.nullish(),
});
export type UserRole = z.infer<typeof userRoleSchema>;
