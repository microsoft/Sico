import { z } from "zod";

// Wire enum — int values, modeled as `z.enum` (TS `enum` banned); access via
// `RecommendationTaskIconSchema.enum.BUILD`. Mirrors legacy's
// `RecommendationTaskIcon` (UNKNOWN=0 … RESEARCH=5). The icon drives which
// glyph renders next to a suggested task; an unrecognized code falls back to
// the console glyph (see `recommendation-task-icon.tsx`).
export const RecommendationTaskIconSchema = z.enum({
  UNKNOWN: 0,
  FALLBACK: 1,
  BUILD: 2,
  THINK: 3,
  WRITE: 4,
  RESEARCH: 5,
});

// One suggested task on the empty-state ConversationStarter. `icon` is a plain
// number (not the strict enum) so a future/unknown code parses cleanly and the
// renderer maps it to the fallback glyph — a stray icon must never reject the
// whole onboarding payload and blank the starter. (Mirrors `message-item`'s
// lenient `type: z.number()`.)
export const recommendationTaskSchema = z.object({
  message: z.string(),
  icon: z.number(),
});
export type RecommendationTask = z.infer<typeof recommendationTaskSchema>;

export const recommendationTasksSchema = z.object({
  tasks: z.array(recommendationTaskSchema),
});
