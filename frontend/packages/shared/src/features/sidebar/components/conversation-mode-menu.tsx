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

import { type JSX, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { DwConversationNav } from "./dw-conversation-nav";
import { DwConversationNavSkeleton } from "./dw-conversation-nav-skeleton";
import { logger } from "../../../utils/logger";

type Props = {
  readonly agentId: string;
};

// The DW conversation-mode menu (Figma 20454:59481), shown in the expanded
// sidebar while inside a Digital Worker. The conversation list is a SUSPENSE
// read wrapped in a local <Suspense> (skeleton) + <ErrorBoundary>. On failure it
// degrades to nothing (`fallback={null}`) rather than an inline message —
// `onError` leaves a diagnostic trail so a broken list endpoint isn't silently
// invisible. `resetKeys={[agentId]}` re-arms the boundary on a DW switch: without
// it, one agent's failed fetch leaves this (non-remounting) boundary stuck on
// `null`, blanking the list for every subsequently-viewed DW until a full sidebar
// remount.
export function ConversationModeMenu({ agentId }: Props): JSX.Element {
  return (
    <ErrorBoundary
      fallback={null}
      resetKeys={[agentId]}
      onError={(error) => {
        logger.error("chat: conversation list fetch failed", {
          agentId,
          error,
        });
      }}
    >
      <Suspense fallback={<DwConversationNavSkeleton />}>
        <DwConversationNav agentInstanceId={Number(agentId)} />
      </Suspense>
    </ErrorBoundary>
  );
}
