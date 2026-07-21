import { z } from "zod";

export const MemberTypeSchema = z.enum({
  OWNER: 1,
  ADMIN: 2,
  MEMBER: 3,
});
export type MemberType = z.infer<typeof MemberTypeSchema>;

// Backend `iconUrl` is either an absolute http(s) URL, a server-relative
// path (e.g. `/storage/1/xxx.svg`), or an empty string — and the backend may
// omit the field entirely (or send `null`). `safeIconUri` performs the final
// scheme allow-list at render time; the schema only normalises absence to `""`
// so consumers keep a plain `string` (they already branch on empty via
// `safeIconUri(iconUrl ?? undefined)`).
const iconUrlSchema = z
  .string()
  .nullish()
  .transform((v) => v ?? "");

// The `/project/user_projects` list marshals each agent instance's avatar
// under `agentIconUrl` (NOT the bare `iconUrl` used by the project itself).
// Read the wire field verbatim, then expose it to consumers as `iconUrl` so
// the card avatar code stays field-name agnostic.
export const projectAgentInstanceSchema = z
  .object({
    id: z.number().int(),
    agentIconUrl: iconUrlSchema,
  })
  .transform(({ agentIconUrl, ...rest }) => ({
    ...rest,
    iconUrl: agentIconUrl,
  }));
export type ProjectAgentInstance = z.infer<typeof projectAgentInstanceSchema>;

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
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
