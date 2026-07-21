import {
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { useStore } from "jotai";
import {
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Composer } from "./composer";
import { MessageHistory } from "./message-history";
import { Sidepane } from "./sidepane/sidepane";
import { ErrorView } from "../../../components/error-view";
import {
  activeConversationAtom,
  activeConversationIdAtom,
  attachmentsAtom,
  conversationsAtom,
  plansAtom,
} from "../atoms/chat-atom";
import {
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "../atoms/sidepane-atom";
import { useConsumePendingMessage } from "../hooks/use-consume-pending-message";
import { invalidateHistory } from "../hooks/use-history";
import { useReconnect } from "../hooks/use-reconnect";
import { useSidebarCollapseOnSidepane } from "../hooks/use-sidebar-collapse-on-sidepane";
import { ChatAgentProvider } from "../services/chat-agent-context";
import { createOnReplay } from "../services/replay";

type Props = {
  agentInstanceId: number;
  // Target conversation (dwp multi-conversation). The route passes the URL
  // `$conversationId`; sico (v1) has no such route and passes `undefined`,
  // keeping the single-implicit-conversation behavior.
  conversationId?: number;
};

/**
 * Public entry for the chat feature: the scrolling message list and the pinned
 * composer under a catch-all `ErrorBoundary` (the self-centering `ErrorView`).
 *
 * Loading topology: `MessageHistory` fetches NON-suspense — it never suspends or
 * throws, so the message list (reads the store) and the Composer stay mounted
 * across loading / error. A first-page history failure degrades to a toast + log
 * inside `useHistory`, leaving the user's just-sent message and the Composer
 * intact — it is NOT caught by this ErrorBoundary. History and the reconnect
 * probe both key off the URL `agentInstanceId`, so they fire in parallel on
 * mount. `onReplay` (buffer-on-race) writes the resumed turn back into history;
 * `stop()` is threaded to the Composer for plan-aware Stop (G4). The outer
 * ErrorBoundary here is the catch-all for genuinely fatal RENDER errors only.
 */
export function Collaboration({
  agentInstanceId,
  conversationId,
}: Props): JSX.Element {
  const store = useStore();
  const queryClient = useQueryClient();
  // Clears any cached query error when the catch-all fallback's "Try again"
  // remounts this subtree. History no longer throws here (it toasts in-place),
  // so this only matters for a fatal render error that trips the boundary.
  const { reset } = useQueryErrorResetBoundary();

  // The chat atoms are module-level jotai singletons, so a param-only switch
  // (no remount) would leak the old view's state into the new one. Reset them
  // whenever the VIEW IDENTITY `(agentInstanceId, conversationId)` changes:
  // switching to another of the same DW's conversations (dwp) changes
  // `conversationId`; switching agents changes `agentInstanceId` (and, in dwp,
  // `conversationId` too). sico (v1) has no `conversationId` (always undefined),
  // so there `agentInstanceId` alone drives the reset — hence BOTH are deps.
  // (first mount no-ops on empty store).
  //
  // useLAYOUTEffect, not useEffect: history now hydrates from a CHILD
  // (`MessageHistory`), and React runs child PASSIVE effects before parent ones.
  // On a cache-hit switch (no suspend), a parent `useEffect` reset would run
  // AFTER the child's hydrate and wipe the freshly-loaded history. The layout
  // phase precedes any passive effect, so this reset always wins.
  //
  // The reset is guarded by the LAST-RESET view key held in a ref, so it runs
  // exactly ONCE per view identity. This is load-bearing for the home→chat
  // first send: the parked message is drained + the SSE opened by a PASSIVE
  // effect (`useConsumePendingMessage`) after this layout-effect's first run;
  // under React StrictMode's dev mount double-invoke the effect re-runs against
  // the SAME fiber (so the ref survives) with an UNCHANGED view key — without
  // the guard that second run would re-reset, wiping the just-sent optimistic
  // message and aborting its fresh SSE (the "first send shows nothing" dev
  // artifact). A genuine view switch changes the key (reset runs); a genuine
  // remount is a new fiber with a fresh ref (reset runs). Prod mounts once, so
  // the guard is a no-op there.
  //
  // The local composer `draft` is unreachable from the store, so it's reset by
  // keying <Composer> on this same view key below.
  const viewKey = `${agentInstanceId}:${conversationId ?? ""}`;
  const lastResetKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastResetKeyRef.current === viewKey) {
      return;
    }
    lastResetKeyRef.current = viewKey;
    // Abort any in-flight send first, or dropping the conversation orphans a
    // running SSE stream + its AbortController.
    store.get(activeConversationAtom)?.sendHandle?.abort();
    // Abort in-flight uploads before clearing, or each upload's AbortController
    // is orphaned and a late failure would toast on the newly-selected agent.
    for (const attachment of store.get(attachmentsAtom)) {
      attachment.abortHandle?.abort();
    }
    store.set(conversationsAtom, new Map());
    store.set(activeConversationIdAtom, null);
    store.set(attachmentsAtom, []);
    // A prior agent's plan trees must not bleed across the switch.
    store.set(plansAtom, new Map());
    // Close any open deliverable/file preview: the pane content is the prior
    // agent's, but the live ChatAgentProvider now resolves the NEW agent's
    // projectId — leaving it open would let "Add to project" publish agent A's
    // file into agent B's project. (The pane reads the persisted atom; nothing
    // else closes it on a param-only agent switch.)
    store.set(sidepaneContentAtom, null);
    store.set(sidepaneMaximizedAtom, false);
  }, [store, viewKey]);

  // Replay handler for the reconnect loop: buffers a resumed-turn run that races
  // ahead of history hydration and flushes it once the turn appears (issue #191).
  // The view key `(agentInstanceId, conversationId)` is a deliberate CACHE KEY,
  // not a value the factory reads: a param-only switch (no remount) must recreate
  // the coalescer so the `[replay]` effect disposes the OLD one — else it survives
  // the switch, leaking a conversationsAtom subscription that could apply the prior
  // view's frames onto a turn of the same id. exhaustive-deps can't see "dep-as-key".
  const replay = useMemo(
    () => createOnReplay(store),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- view key (forces re-create on agent/conversation switch), not read by createOnReplay
    [store, agentInstanceId, conversationId],
  );
  useEffect(() => replay.dispose, [replay]);

  // Mount the reconnect loop (probe on mount, parallel with history) and thread
  // its hard-idle `stop()` to the Composer so Stop routes through it (G4). A
  // reconnect-resumed turn settles inside this loop (no `sendMessage` closure to
  // fire `onSettle`), so invalidate history here too — symmetric with the live
  // send path (use-chat) — else a revisit within staleTime re-serves the
  // pre-reload cache, which is missing the resumed turn.
  const onReconnectSettle = useCallback(
    () => invalidateHistory(queryClient, agentInstanceId, conversationId),
    [queryClient, agentInstanceId, conversationId],
  );
  const { stop: reconnectStop } = useReconnect(
    agentInstanceId,
    conversationId,
    {
      onReplay: replay.onReplay,
      onSettle: onReconnectSettle,
    },
  );

  // Drain a message composed on the empty-state home (parked in
  // pendingMessageAtom, then navigated here). Runs as a passive effect —
  // i.e. AFTER the reset layout-effect above — so the send lands in the
  // freshly-reset store instead of being wiped.
  useConsumePendingMessage(agentInstanceId, conversationId);

  // Collapse the main Sidebar while the preview Sidepane is open (it takes ~75%
  // of the row), restoring it on close. Reads/writes the shared store since the
  // Sidebar mounts at the app shell, out of this subtree.
  useSidebarCollapseOnSidepane();

  return (
    <ErrorBoundary
      FallbackComponent={ErrorView}
      onReset={reset}
      resetKeys={[agentInstanceId, conversationId]}
    >
      {/* The agent id + conversation id ride an ambient context so a leaf
          PlanCard can mount its /plan poll (which needs both to address the
          plan) without prop-drilling through MessageList + MessageCard.
          `conversationId ?? 0`: the only route that renders <Collaboration>
          always supplies it; 0 is the legacy "no conversation" sentinel the
          backend still resolves by turn lookup. */}
      <ChatAgentProvider
        agentInstanceId={agentInstanceId}
        conversationId={conversationId ?? 0}
      >
        {/* Horizontal row so the Sidepane is a flex SIBLING that pushes the chat
            left (inline push, MP1/MP2). min-h-0 preserves the inner scroll. */}
        <div className="flex min-h-0 flex-1">
          {/* min-w-0: without it the chat's min-content (composer + messages)
              refuses to shrink past ~min width and breaks the ~25% split when
              the panel is open. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              {/* NON-suspense: MessageHistory owns its own skeleton gate (empty
                  first load only) and never throws — the Composer below always
                  stays mounted, even when history fails. */}
              <MessageHistory
                agentInstanceId={agentInstanceId}
                conversationId={conversationId}
              />
            </div>
            <Composer
              key={viewKey}
              agentInstanceId={agentInstanceId}
              conversationId={conversationId}
              reconnectStop={reconnectStop}
            />
          </div>
          {/* Bare sibling (no grow wrapper): open, the panel's own w-3/4 is its
              flex basis and the chat's flex-1 absorbs the remaining ~25%; closed,
              it animates to a w-0 shell so the chat reclaims the full row. */}
          <Sidepane />
        </div>
      </ChatAgentProvider>
    </ErrorBoundary>
  );
}
