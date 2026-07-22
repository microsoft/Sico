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

import { DeviceButton } from "@sico/shared";
import { conversationListQueryOptions } from "@sico/shared/features/chat/index.ts";
import {
  AgentDetailLayout,
  agentQueryOptions,
} from "@sico/shared/features/digital-worker/index.ts";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Layout shell for a single Digital Worker. The loader prefetches agent detail
// (Header suspense query) and the sidebar's conversation list (fire-and-forget)
// so both hit cache on mount — the list renders without a skeleton flash, like
// the agent detail. The layout + error boundary live in the shared feature;
// this route only owns the router primitives (params + Outlet) and wires the
// chat Device button into the Header's actions slot.
export const Route = createFileRoute("/_authed/digital-worker/$agentId")({
  loader: ({ context, params }) => {
    const agentId = Number(params.agentId);
    if (Number.isFinite(agentId)) {
      void context.queryClient.prefetchQuery(
        agentQueryOptions(agentId, context.apiClient),
      );
      void context.queryClient.prefetchInfiniteQuery(
        conversationListQueryOptions(agentId, context.apiClient),
      );
    }
  },
  head: () => ({ meta: [{ title: "Digital Worker · SICO" }] }),
  component: DwAgentRoute,
});

function DwAgentRoute(): JSX.Element {
  const { agentId } = Route.useParams();
  return (
    <AgentDetailLayout
      agentId={agentId}
      actions={<DeviceButton agentInstanceId={Number(agentId)} />}
    >
      <Outlet />
    </AgentDetailLayout>
  );
}
