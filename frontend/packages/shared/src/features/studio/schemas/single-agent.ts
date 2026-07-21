import { z } from "zod";

// Detail for a single studio agent (GET /agent/single_agent?agentId=<uuid>).
// Distinct from `singleAgentCardSchema` (the studio list payload) and the
// numeric instance `agentSchema` (single_agent_instance). `agentId` is the UUID
// used as the `$agentId` route param on the setup page; name/role feed Basic
// Info. Parsed leniently — a freshly-created draft may omit name/role.
export const singleAgentDetailSchema = z.object({
  agentId: z.string(),
  name: z.string().optional(),
  role: z.string().optional(),
  desc: z.string().optional(),
});
export type SingleAgentDetail = z.infer<typeof singleAgentDetailSchema>;

// Backend wraps the agent in `{ agent: {...} }`. Transform to the bare detail
// so hooks/components consume the canonical `SingleAgentDetail`.
export const singleAgentPayloadSchema = z
  .object({ agent: singleAgentDetailSchema })
  .transform(({ agent }): SingleAgentDetail => agent);
