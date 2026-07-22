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
