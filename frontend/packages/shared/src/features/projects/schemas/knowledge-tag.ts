import { z } from "zod";

// The dialog's "When to use" field maps to `description` — there is no
// `whenToUse`. `name` is capped at 256 to mirror the backend `binding` (§7 D).
export const knowledgeTagSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int(),
  name: z.string().max(256),
  description: z.string(),
  creatorUsername: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type KnowledgeTag = z.infer<typeof knowledgeTagSchema>;
