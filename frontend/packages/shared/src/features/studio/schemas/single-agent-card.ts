import { z } from "zod";

// Lightweight agent card for the Studio list. Mirrors legacy dwp
// `SingleAgentCard` (GET dwp/agent/single_agent_infos) — distinct from the
// richer `agentSchema` (single_agent_instances). `agentId` is a string here
// (legacy contract); used directly as the `$agentId` route param.
export const singleAgentCardSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  role: z.string().optional(),
  creatorUsername: z.string().optional(),
  // Present in the wire payload but not rendered by the card. Parsed loosely
  // so a malformed/absent tags array never fails the whole list parse.
  capabilityTags: z.array(z.string()).optional().catch(undefined),
});
export type SingleAgentCard = z.infer<typeof singleAgentCardSchema>;

// Backend wraps the list in `{ agentInfos: [...] }`. Transform to a bare
// array so hooks/components consume the canonical `SingleAgentCard[]`.
export const agentInfosPayloadSchema = z
  .object({ agentInfos: z.array(singleAgentCardSchema).default([]) })
  .transform(({ agentInfos }): SingleAgentCard[] => agentInfos);
