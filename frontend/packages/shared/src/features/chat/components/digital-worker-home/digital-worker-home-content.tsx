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

import { toast } from "@sico/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { type JSX, Suspense, useLayoutEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { DigitalWorkerHomeHero } from "./digital-worker-home-hero";
import { SuggestedTasks } from "./suggested-tasks";
import { SuggestedTasksSkeleton } from "./suggested-tasks-skeleton";
import { logger } from "../../../../utils/logger";
import { useAgentSuspenseQuery } from "../../../digital-worker/hooks/use-agents-query";
import {
  activeConversationIdAtom,
  pendingMessageAtom,
} from "../../atoms/chat-atom";
import {
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "../../atoms/sidepane-atom";
import { useCreateConversation } from "../../hooks/use-create-conversation";
import { seedEmptyHistory } from "../../hooks/use-history";
import { useSidebarCollapseOnSidepane } from "../../hooks/use-sidebar-collapse-on-sidepane";
import { type ChatAttachmentRef } from "../../schemas/chat-request";
import { delayStyle, REVEAL_CLASS } from "../../utils/reveal";
import { Composer } from "../composer";
import { Sidepane } from "../sidepane/sidepane";

type Props = {
  agentInstanceId: number;
  // Fired with the freshly-minted conversation id AFTER the message is parked.
  // The consumer navigates to /collaboration/$conversationId, where the parked
  // message is drained and sent. Kept as a callback so @sico/shared owns no
  // route literals.
  onSubmitted: (conversationId: number) => void;
};

// The DW home's content (under the agent-query Suspense boundary owned by
// `DigitalWorkerHome`). `create-first`: on submit the message mints a fresh
// conversation (`POST /conversation`), parks the payload in
// pendingMessageAtom, and navigates to /collaboration/$conversationId,
// where `useConsumePendingMessage` drains and sends it post-reset. The Composer
// is controlled (`value`/`onChange`) so a suggested-task click can prefill it
// and a failed create can restore the text.
export function DigitalWorkerHomeContent({
  agentInstanceId,
  onSubmitted,
}: Props): JSX.Element {
  const queryClient = useQueryClient();
  const { data: agent } = useAgentSuspenseQuery(agentInstanceId);
  const setPending = useSetAtom(pendingMessageAtom);
  const setActiveConversationId = useSetAtom(activeConversationIdAtom);
  const setSidepaneContent = useSetAtom(sidepaneContentAtom);
  const setSidepaneMaximized = useSetAtom(sidepaneMaximizedAtom);
  const createConversation = useCreateConversation();
  const [draft, setDraft] = useState("");
  // Synchronous double-submit guard. `createConversation.isPending` only flips
  // on a re-render, so two Enter/clicks in the SAME tick both pass a state-based
  // check and fire two `POST /conversation` (the second wins, the first is
  // orphaned). A ref set inline blocks the second call immediately.
  const submittingRef = useRef(false);

  // Collapse the main Sidebar while the preview Sidepane is open — same behavior
  // as the chat page, so the Device (sandbox) button in the header opens a pane
  // here on the DW home too (it sets the shared sidepane atom this reads).
  useSidebarCollapseOnSidepane();

  // The home composer belongs to no conversation (create-first). Clear any active
  // conversation left over from a previously-open chat, or the composer's shared
  // `isStreaming`/`isRequestPending` atoms would read that conversation's live
  // state and render a Stop button here while it streams. useLayoutEffect (not
  // useEffect) so the clear commits BEFORE paint — a passive effect would let the
  // first frame paint a Stop button (reading the stale active conversation) and
  // then flip to Send. Mount-only: a send navigates away before it opens a stream,
  // so this never races the send.
  useLayoutEffect(() => {
    setActiveConversationId(null);
  }, [setActiveConversationId]);

  // Close any sidepane the header Device button opened, keyed on the agent. The
  // sidepane atom is a shared app-wide singleton and <Sidepane /> (below) reads
  // it, but only Collaboration's reset nulls it — the home never did. DW nav
  // links target the home (`/digital-worker/$agentId`), so switching DWs is a
  // param-only change (no remount): a mount-only clear wouldn't re-run and DW
  // A's open pane would linger on DW B's home. Keying on agentInstanceId re-runs
  // the reset on every switch. useLayoutEffect (not useEffect) so the pane is
  // gone before paint, matching Collaboration's own sidepane reset.
  useLayoutEffect(() => {
    setSidepaneContent(null);
    setSidepaneMaximized(false);
  }, [agentInstanceId, setSidepaneContent, setSidepaneMaximized]);

  const handleSubmit = (
    text: string,
    attachments: ChatAttachmentRef[],
  ): void => {
    // Block a same-tick re-entry (see `submittingRef`). On success the component
    // navigates away (no reset needed); on failure the ref is cleared so a retry
    // works.
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    // Mint the conversation first so it's addressable (routed + listed) from the
    // first message. On success park + navigate. On failure the draft +
    // attachments survive in the Composer (it does NOT clear on the onSubmit
    // path), so the user can retry without re-typing or re-attaching. No title is
    // sent — the backend names the conversation (and renames it from the first
    // message), so the client doesn't derive one.
    createConversation.mutate(
      { agentInstanceId },
      {
        onSuccess: (conversation) => {
          // Prime the history cache with an empty page so the chat page's
          // MessageHistory doesn't suspend on mount — the parked message renders
          // immediately in one MessageList instance (no skeleton flash).
          seedEmptyHistory(queryClient, agentInstanceId, conversation.id);
          setPending({
            agentInstanceId,
            conversationId: conversation.id,
            text,
            attachments,
          });
          onSubmitted(conversation.id);
        },
        onError: (error) => {
          submittingRef.current = false;
          logger.error("chat: create conversation failed", {
            agentInstanceId,
            error,
          });
          toast.error("Couldn't start a conversation. Please try again.");
        },
      },
    );
  };

  return (
    // Flex row so the Sidepane is a sibling that pushes the home content left
    // (inline push, mirrors Collaboration). `min-h-0 flex-1` — NOT `h-full` —
    // matches Collaboration's height model exactly: as the second child of the
    // shared vertical AgentDetailLayout column (Header + this), it takes the space
    // left under the fixed-height Header and, crucially, `min-h-0` lets it shrink
    // below its content's min-height. Without that, an open Sidepane's tall
    // previewer inflates this row and pushes the Header up — and the `h-full`
    // model also left the Header a few px off Collaboration's, so switching
    // between the two flickered. The canvas column's `overflow-y-auto` absorbs
    // any overflow; `min-w-0` lets it shrink past its content when the pane opens.
    <div className="flex min-h-0 w-full flex-1">
      <div className="bg-surface-canvas h-full min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto -mt-16 flex h-full max-w-190 flex-col justify-center px-5">
          <div className={REVEAL_CLASS} style={delayStyle(0)}>
            <DigitalWorkerHomeHero agent={agent} />
          </div>
          <div className={REVEAL_CLASS} style={delayStyle(120)}>
            <Composer
              agentInstanceId={agentInstanceId}
              value={draft}
              onChange={setDraft}
              onSubmit={handleSubmit}
              submitting={createConversation.isPending}
            />
          </div>
          {/* Suggested tasks suspend independently: a local boundary keeps the
              hero + composer above usable while they load, and a thrown fetch
              degrades to "no suggestions" (fallback={null}) rather than blanking
              the page. `onError` leaves a diagnostic trail so a broken onboarding
              endpoint isn't silently invisible. */}
          <ErrorBoundary
            fallback={null}
            onError={(error) => {
              logger.error("chat: recommendation tasks fetch failed", {
                agentInstanceId,
                error,
              });
            }}
          >
            <Suspense fallback={<SuggestedTasksSkeleton />}>
              <SuggestedTasks
                agentInstanceId={agentInstanceId}
                onSelect={setDraft}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
      {/* Bare sibling: open, the panel's own w-3/4 is its flex basis and the
          canvas column's flex-1 absorbs the rest; closed, it animates to a w-0
          shell so the home reclaims the full row. */}
      <Sidepane />
    </div>
  );
}
