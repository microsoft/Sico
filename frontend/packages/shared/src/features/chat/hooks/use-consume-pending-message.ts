import { useStore } from "jotai";
import { useEffect } from "react";

import { useChat } from "./use-chat";
import { pendingMessageAtom } from "../atoms/chat-atom";

// Drains the hand-off slot parked by the empty-state DigitalWorkerHome and
// fires the send, exactly once, AFTER Collaboration has mounted and reset its
// store. Ordering is load-bearing: Collaboration's reset runs in a
// useLAYOUTEffect, so this PASSIVE effect (which React flushes after layout
// effects) sends into the freshly-reset store rather than having its turn wiped.
// The atom is cleared before sending so a re-render — or a real unmount/remount
// — never double-sends or re-sends an already-delivered message.
//
// The drain is SCOPED to the (agent, conversation) pair: a parked payload only
// fires on the Collaboration whose `agentInstanceId` AND `conversationId` match,
// so a stale park (its navigation interrupted, or the user reached a different
// conversation first) can never be sent to the wrong digital worker or the wrong
// conversation — a non-matching park is left untouched for its own view. Parking
// is dwp-only (the DW home always mints a real conversation id before parking),
// so `pending.conversationId` is always defined; sico (v1) never parks here and
// sends in place instead.
//
// Ordering with Collaboration's reset (DEV StrictMode): under StrictMode's mount
// double-invoke (setup → cleanup → setup), the first setup sends and seeds the
// optimistic message. Collaboration's reset layout-effect is GUARDED by a
// last-reset view-key ref, so its second invocation is a no-op — it does NOT
// re-wipe that message. (Before the guard, the second reset cleared the store
// and the message appeared to vanish in dev; prod mounts once and was always
// fine.) This hook still CLEARS the slot before sending, so a re-render or a
// real unmount/remount never double-sends. Re-parking on cleanup to restore the
// row was rejected: it can't tell a StrictMode pseudo-unmount from a real
// navigation-away, so on a genuine unmount it would re-send an already-delivered
// message — a production regression. The reset guard preserves the row without
// that risk, so not-double-sending remains the invariant (see the StrictMode
// test).
export function useConsumePendingMessage(
  agentInstanceId: number,
  conversationId?: number,
): void {
  const store = useStore();
  const { send } = useChat(agentInstanceId, conversationId);

  useEffect(() => {
    const pending = store.get(pendingMessageAtom);
    if (
      pending === null ||
      pending.agentInstanceId !== agentInstanceId ||
      pending.conversationId !== conversationId
    ) {
      return;
    }
    store.set(pendingMessageAtom, null);
    // Forward the parked conversationId EXPLICITLY so the send targets it even
    // if `useHistory` hasn't yet hydrated the slot (create-first race). The
    // `pending.conversationId === conversationId` guard above already proved
    // they match, so either could be passed — use the pending one for clarity.
    void send(pending.text, pending.attachments, pending.conversationId);
  }, [store, send, agentInstanceId, conversationId]);
}
