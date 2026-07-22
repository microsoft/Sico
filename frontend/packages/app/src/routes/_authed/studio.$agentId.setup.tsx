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

import {
  rolesQueryOptions,
  SETUP_SKILLS_PAGE_SIZE,
  skillsInfiniteQueryOptions,
} from "@sico/shared/features/skill/index.ts";
import {
  AgentSetupPage,
  singleAgentQueryOptions,
} from "@sico/shared/features/studio/index.ts";
import { createFileRoute } from "@tanstack/react-router";
import type { JSX } from "react";

// Edit-mode setup for an existing studio Digital Worker. The page body lives in
// @sico/shared (AgentSetupPage); this route owns the agent/skills/roles prefetch
// so the body's suspense queries hit cache.
export const Route = createFileRoute("/_authed/studio/$agentId/setup")({
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      singleAgentQueryOptions(context.apiClient, params.agentId),
    );
    void context.queryClient.prefetchInfiniteQuery(
      skillsInfiniteQueryOptions(context.apiClient, {
        agentId: params.agentId,
        pageSize: SETUP_SKILLS_PAGE_SIZE,
      }),
    );
    void context.queryClient.prefetchQuery(
      rolesQueryOptions(context.apiClient),
    );
  },
  head: () => ({ meta: [{ title: "Setup · SICO" }] }),
  component: RouteComponent,
});

function RouteComponent(): JSX.Element {
  const { agentId } = Route.useParams();
  return <AgentSetupPage agentId={agentId} />;
}
