import { z } from "zod";

export const MemberTypeSchema = z.enum({
  OWNER: 1,
  ADMIN: 2,
  MEMBER: 3,
});
export type MemberType = z.infer<typeof MemberTypeSchema>;

// The project's own avatar URL (`icon_sas_url` → json `iconUrl`): an absolute
// http(s) URL, a server-relative path, or an empty string; Go may marshal an
// unset value as `null`. Coerce null|undefined → "" so it never fails the parse;
// `safeIconUri` does the scheme allow-list at render time.
const iconUrlSchema = z
  .string()
  .nullish()
  .transform((v) => v ?? "");

// The backend digest's avatar field is `agentIconUrl` (common.AgentInstanceDigest
// → `agent_icon_url`), NOT `iconUrl`. Go marshals an unset value as JSON `null`
// or omits it, so accept null|undefined and coerce to "" — one iconless agent
// can't fail the project parse; `safeIconUri` does the scheme allow-list at
// render time (an empty string renders the fallback avatar). Renamed to the
// canonical `iconUrl` here so avatar consumers read one field name.
export const projectAgentInstanceSchema = z
  .object({
    id: z.number().int(),
    agentIconUrl: z
      .string()
      .nullish()
      .transform((v) => v ?? ""),
  })
  .transform(({ id, agentIconUrl }) => ({ id, iconUrl: agentIconUrl }));
export type ProjectAgentInstance = z.infer<typeof projectAgentInstanceSchema>;

// A member/admin summary the detail endpoint embeds (`common.UserDigest`).
// `projectMembers` is the FULL roster (admins included); `projectAdmins` is the
// admin subset. `alias`/`iconUrl` may be empty strings the backend sends.
export const projectMemberDigestSchema = z.object({
  id: z.number().int(),
  alias: z.string().optional(),
  username: z.string(),
  email: z.string(),
  iconUrl: z.string().optional(),
});
export type ProjectMemberDigest = z.infer<typeof projectMemberDigestSchema>;

// A sandbox summary the detail endpoint embeds (`common.SandboxDigest`). The
// drawer only needs `type` (bucket) + `status` (availability); the rest are
// carried for completeness/forward-compat. Camel-case (detail endpoint), unlike
// the snake_case `/sandbox/list` payload.
export const projectSandboxDigestSchema = z.object({
  sandboxId: z.string(),
  type: z.string(),
  status: z.string(),
  displayName: z.string().optional(),
  projectId: z.number().int().optional(),
});
export type ProjectSandboxDigest = z.infer<typeof projectSandboxDigestSchema>;

export const projectSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string(),
  iconUrl: iconUrlSchema,
  memberType: MemberTypeSchema,
  // Go marshals an empty slice as JSON `null`; `.default([])` only fills
  // `undefined`. Coerce null|undefined → [] so a project with no agents
  // parses instead of throwing (same invariant as `operatorAdmins`, §6 dec 6).
  agentInstances: z
    .array(projectAgentInstanceSchema)
    .nullish()
    .transform((v) => v ?? []),
});
export type Project = z.infer<typeof projectSchema>;

// Project detail (`GET /project?id`) — the list shape PLUS the fields only the
// detail endpoint returns. Extends `projectSchema` so the list view stays
// narrow (§6 B): widening the base would leak detail-only fields into the grid.
export const projectDetailSchema = projectSchema.extend({
  // The detail endpoint (`GET /project?id`) marshals an unset role as Go's
  // zero-value `0`, which `MemberTypeSchema` (1|2|3) does not model. Accept it
  // explicitly here so detail parse never throws; `canEdit` treats `0` as
  // read-only (§8 A).
  memberType: z.union([MemberTypeSchema, z.literal(0)]),
  ownerUsername: z.string(),
  creatorUsername: z.string(),
  // Go marshals an empty slice as JSON `null`; `.default([])` only fills
  // `undefined`. Coerce null|undefined → [] so this always resolves to a full
  // array (the operator data-loss invariant, §6 dec 6).
  operatorAdmins: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  // Full member roster (admins included) + the admin subset — `UserDigest`
  // arrays the detail endpoint returns. Nullish→[] like the sibling arrays (Go
  // marshals empty slices as `null`). `projectMembers` is the source of truth
  // for the roster preview count; `operatorAdmins` above is only the admin
  // usernames and undercounts.
  projectMembers: z
    .array(projectMemberDigestSchema)
    .nullish()
    .transform((v) => v ?? []),
  projectAdmins: z
    .array(projectMemberDigestSchema)
    .nullish()
    .transform((v) => v ?? []),
  // Sandboxes bound to this project (`common.SandboxDigest[]`). Same data the
  // drawer used to fetch via `/sandbox/list?projectId`; now read inline so the
  // drawer's Sandbox section needs no separate query. Nullish→[].
  sandboxes: z
    .array(projectSandboxDigestSchema)
    .nullish()
    .transform((v) => v ?? []),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
