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

import { DigitalWorkerHome } from "@sico/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type JSX } from "react";

// `/digital-worker/$agentId` index — ALWAYS the DW home page (hero + composer +
// suggested tasks). DigitalWorkerHome owns its own agent-query Suspense
// boundary, so this route is a thin mount. Sending parks the message and calls
// `onSubmitted`, which navigates to /collaboration where the chat drains + sends
// it. DW nav links target /collaboration directly, so only the explicit index
// URL lands here. No loader: SuggestedTasks fetches its recommendations on mount
// behind its own local Suspense boundary.
export const Route = createFileRoute("/_authed/digital-worker/$agentId/")({
  component: DwAgentHome,
});

function DwAgentHome(): JSX.Element {
  const { agentId } = Route.useParams();
  const agentInstanceId = Number(agentId);
  const navigate = useNavigate();
  return (
    <DigitalWorkerHome
      agentInstanceId={agentInstanceId}
      onSubmitted={(conversationId) => {
        void navigate({
          to: "/digital-worker/$agentId/collaboration/$conversationId",
          params: {
            agentId: String(agentInstanceId),
            conversationId: String(conversationId),
          },
          // replace: the home is a launch pad — after sending, Back should not
          // return here and re-show the empty composer.
          replace: true,
        });
      }}
    />
  );
}
