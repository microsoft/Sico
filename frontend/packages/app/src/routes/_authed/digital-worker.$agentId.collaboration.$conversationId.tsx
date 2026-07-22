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

import { Collaboration } from "@sico/shared";
import {
  historyQueryOptions,
  resolveChatEndpoints,
} from "@sico/shared/features/chat/index.ts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type JSX } from "react";

import { backendProfile } from "@/services/backend-profile";

// The chat for one conversation of a Digital Worker. <Collaboration> fetches
// history NON-suspense (a failure toasts in-place, never replacing the message
// list or Composer), so the route is a thin mount.
export const Route = createFileRoute(
  "/_authed/digital-worker/$agentId/collaboration/$conversationId",
)({
  // Non-numeric params (hand-typed or stale URL) address no real chat; redirect
  // before the loader so NaN never flows into the history query key + request
  // params. A bad `agentId` can't target the DW home (that route needs a valid
  // id), so it falls back to the DW list; a bad `conversationId` under a valid
  // agent bounces to that agent's home (mirrors the sibling index route).
  beforeLoad: ({ params }) => {
    if (!Number.isFinite(Number(params.agentId))) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `redirect()` is the documented control-flow signal
      throw redirect({ to: "/digital-worker", replace: true });
    }
    if (!Number.isFinite(Number(params.conversationId))) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `redirect()` is the documented control-flow signal
      throw redirect({
        to: "/digital-worker/$agentId",
        params: { agentId: params.agentId },
        replace: true,
      });
    }
  },
  // Warm the first history page for THIS conversation so <Collaboration>'s
  // MessageHistory renders from cache without a loading flash (fire-and-forget;
  // a failure surfaces later as an in-place toast, leaving the panel intact).
  // `messagesPath` is a build-time constant from the active backend profile, so
  // it's resolvable outside React here.
  loader: ({ context, params }) => {
    const agentId = Number(params.agentId);
    const conversationId = Number(params.conversationId);
    if (Number.isFinite(agentId) && Number.isFinite(conversationId)) {
      const { messagesPath } = resolveChatEndpoints(
        backendProfile.chatEndpoints,
      );
      void context.queryClient.prefetchInfiniteQuery(
        historyQueryOptions(
          agentId,
          context.apiClient,
          messagesPath,
          conversationId,
        ),
      );
    }
  },
  component: DwAgentConversation,
});

function DwAgentConversation(): JSX.Element {
  const { agentId, conversationId } = Route.useParams();
  return (
    <Collaboration
      agentInstanceId={Number(agentId)}
      conversationId={Number(conversationId)}
    />
  );
}
