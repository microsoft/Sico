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

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type JSX } from "react";

// Layout segment for `/digital-worker/$agentId/collaboration`. The chat lives at
// the `$conversationId` child (multi-conversation); this segment only renders an
// <Outlet>. A bare `/collaboration` (no conversation) is handled by the sibling
// index route, which redirects to the DW home. History prefetch moved to the
// child route, which knows the target conversation id.
export const Route = createFileRoute(
  "/_authed/digital-worker/$agentId/collaboration",
)({
  component: DwAgentCollaborationLayout,
});

function DwAgentCollaborationLayout(): JSX.Element {
  return <Outlet />;
}
