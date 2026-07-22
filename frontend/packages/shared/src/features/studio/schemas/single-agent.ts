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
