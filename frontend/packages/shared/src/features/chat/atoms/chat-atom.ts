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

import { enableMapSet } from "immer";
import { atom, type Atom } from "jotai";
import { selectAtom } from "jotai/utils";

import { type ChatAttachmentRef } from "../schemas/chat-request";
import { type MessageAttachment } from "../schemas/message-item";
import { type Plan } from "../schemas/plan";

// immer needs MapSet support to `produce` on a Map/Set. Called once at module
// load; idempotent. This is the only place it is enabled.
enableMapSet();

// A rendered turn is a list of Parts. Discriminated on `type`: a `text` Part
// carries Markdown; a `plan` Part is a pointer into `plansAtom` (the tree lives
// there, not inline, so polling can refresh it without rewriting history).
// `planId` identity (1:1, pinned here so producer/poller/reader agree on the
// key): a `plan` Part's `planId` IS the turn's `turnId` rendered as a string —
// `planId === String(turnId)`. The PLAN frame carries a numeric `turnId`; the
// frame-reducer mints `planId: String(turnId)`, `use-plan` polls `GET /plan` by
// the numeric `turnId`, and `plansAtom` / `PlanCard` key off the string
// `planId` (matching `planSchema`'s `planId = String(plan.extra.turnId)`).
export type Part =
  | { partId: string; type: "text"; text: string }
  | { partId: string; type: "plan"; planId: string };

// AI messages only. `human` messages stay content-only (no streamingState).
// `pending`: the placeholder is created on click but the stream has not opened
// yet (the ↻ window — thinking shows, the button is loading). `streaming`:
// `onopen` fired and frames flow (the button flips to Stop).
export type StreamingState = "pending" | "streaming" | "done" | "error";

// The terminal subset of StreamingState — the two states a turn can settle to.
// `Extract` (not a fresh literal union) keeps it compiler-locked to its parent,
// so adding a terminal member to StreamingState propagates here automatically.
// Shared by the reconnect `settle` command, `settleTurn`, and the hook's settle.
export type TerminalStreamingState = Extract<StreamingState, "done" | "error">;

// A message attachment is a ready upload ref (chatAttachmentRefSchema shape)
// plus an optional `id` — the upload id legacy keeps on the message item but
// drops from the send payload (chat-request.ts). §8: reuse the ref type rather
// than redefine a schema here. The shape is owned by `messageAttachmentSchema`
// (message-item.ts), which does exactly that (`chatAttachmentRefSchema.extend({
// id })`) — schema-owns-the-shape, the same direction as `Plan` above. Unlike
// `Plan` (whose canonical import site is its schema), this type is *also*
// re-exported here to preserve the store's pre-existing public export of
// `MessageAttachment`.
export type { MessageAttachment };

export type Message = {
  id: string;
  author: "human" | "ai";
  content: Part[];
  streamingState?: StreamingState;
  attachments?: MessageAttachment[]; // C2/C3 history threading; absent in a plain C1 turn
  turnId?: number; // server turn id (int64 number on the wire); `String(turnId)` is a plan Part's planId
  createdAt?: number; // server timestamp in history; the optimistic human send stamps a client `Date.now()` so its bubble shows a time pre-reload (display-only)
  experienceCount?: number; // ACE experience count from a type=8 history item (numOperations); drives the Experience +N pill (§9 P21)
  experiencePlaybookId?: number; // type=8 payload's playbookId; the pill's `View more` navigates to /project/$projectId/experience/$assetId. Optional: a missing/invalid id leaves View more inert
  // Transient: the plan tree parsed from a type-9 history row's inline content.
  // `useHistory` drains it into `plansAtom` during hydration, then it is never
  // read again — renderers read the tree from `plansAtom` via the `plan` Part's
  // `planId`, never off the Message. Absent on live turns (the SSE PLAN frame
  // carries no tree) and on rows whose inline content was empty/unparseable.
  seedPlan?: Plan;
};

// "Is this the live AI turn?" — an AI message still in the `streaming` state.
// The single source for that question: `isStreamingAtom`, the reconnect
// staleness gate (use-reconnect), and Stop (stop-turn) all key off it, so the
// definition lives here beside `Message` rather than being re-spelled at each
// call site. (History-row matching by turnId — replay.ts — is a DIFFERENT query
// and deliberately not folded in here.)
export function isStreamingAiMessage(message: Message): boolean {
  return message.author === "ai" && message.streamingState === "streaming";
}

export type Conversation = {
  clientId: string; // Map key — client-minted (crypto.randomUUID), never the server id
  conversationId?: number; // server id — captured (write-only in C1) from the first frame that carries it; read back in C2/C3 history threading, never in C1
  history: Message[];
  // The in-flight send's AbortController: present from click through the
  // terminal (done/error/abort), then cleared. Single source for the three
  // derived states below (§7).
  sendHandle?: AbortController;
};

export type AttachmentStatus = "uploading" | "ready";

export type Attachment = {
  localId: string;
  file: File;
  status: AttachmentStatus;
  assetRef?: ChatAttachmentRef; // present once `ready`
  abortHandle?: AbortController; // present while `uploading`
};

// --- primitive atoms ---------------------------------------------------------

export const conversationsAtom = atom<Map<string, Conversation>>(new Map());
export const activeConversationIdAtom = atom<string | null>(null);
export const attachmentsAtom = atom<Attachment[]>([]);

// Unified "last stream liveness seen" wall-clock (`Date.now()`), stamped by BOTH
// transports on stream open and on every frame — keepalives included, via each
// transport's `onLive` hook (chat.ts live-send + use-reconnect). The recovery
// gate reads it to decide whether an in-flight turn's stream is stale: the
// backend's keepalive cadence keeps a healthy stream's stamp fresh, so a stale
// stamp means the stream is presumed dead — the gate then hands the turn to
// reconnect. Guards against reconnecting a still-healthy stream (a false
// hand-off is churn + a toast flash, not corruption — reset-then-replay rebuilds
// the row from head). A timestamp (not a timer) so it survives the OS freezing
// timers during sleep — the whole reason the wake path can't rely on setTimeout.
export const lastActivityAtom = atom<number>(0);

// Server ids of conversations created in THIS session whose title is still the
// async "New Session" placeholder. The sole trigger for title polling — it
// replaces the ambiguous "title === 'New Session'" heuristic: a conversation
// that legitimately (or permanently) carries that name is never in this set, so
// it is never polled. `useCreateConversation` adds an id on create; the sidebar
// poll removes it once the real title lands OR its 1-min budget expires. Deliberately
// NOT cleared by Collaboration's mount reset (the id must survive create→navigate)
// and deliberately not persisted (a reload abandons any un-resolved poll).
export const pendingTitleConversationIdsAtom = atom<Set<number>>(
  new Set<number>(),
);

// Server ids of conversations created via the create-first flow (DW home → first
// message) whose FIRST send is still in flight. The create-first flow seeds an
// immediately-stale EMPTY history page, so the chat page's mount refetches page 1
// — which the backend has already persisted the just-sent human turn into. That
// page-1 refetch, merged while the optimistic (still turnId-less) row is in the
// store, would render the turn twice (neither id nor turnId dedup catches the
// twin). `useHydrateHistory` reads this set to skip merging page 1 ONLY for these
// conversations while a send is in flight — an EXISTING conversation (not in this
// set) whose page 1 holds real history is never skipped, so its history isn't
// stranded. `useCreateConversation` adds the id at create; the send's `onSettle`
// (use-chat) removes it once the first turn is persisted — from then on page 1 is
// real history, not a twin, so a later cold revisit + in-flight send must NOT
// skip it. Bounded to the first-send window; not persisted (a reload starts fresh
// — the seed is gone too).
export const createFirstConversationIdsAtom = atom<Set<number>>(
  new Set<number>(),
);

// Hand-off slot for a message composed on the empty-state DigitalWorkerHome
// (the `/digital-worker/$id` index) and sent AFTER navigating to
// `/collaboration/$conversationId`. The home cannot send in place: Collaboration's
// mount resets the chat store (clears conversations + aborts in-flight sends), so
// a send-then-navigate would be wiped. Instead the home mints a conversation
// (create-first), parks the payload here, and `useConsumePendingMessage` drains
// it once Collaboration has mounted and reset. Null when there's nothing pending.
// `agentInstanceId` + `conversationId` scope the drain: a stale park (navigation
// interrupted) must NOT be sent to whichever conversation's Collaboration mounts
// next, so the consumer only drains a matching (agent, conversation) pair.
export type PendingMessage = {
  agentInstanceId: number;
  conversationId: number;
  text: string;
  attachments: ChatAttachmentRef[];
};
export const pendingMessageAtom = atom<PendingMessage | null>(null);

// Plan trees keyed by `planId` (= `String(turnId)`, see `Part`). The
// authoritative writer is `use-plan`, which reconciles each poll's parsed `Plan`
// into this Map; `use-history` also seeds it if-absent from a type-9 row's inline
// tree (never clobbering a live poll). `plan` Parts and `PlanCard` only read it.
export const plansAtom = atom<Map<string, Plan>>(new Map());

// --- derived atoms -----------------------------------------------------------

export const activeConversationAtom = atom<Conversation | undefined>((get) => {
  const id = get(activeConversationIdAtom);
  return id === null ? undefined : get(conversationsAtom).get(id);
});

// Scoped read for message-list: the active conversation's history array.
// Re-derives only when that conversation changes (not when a sibling
// conversation does) — §8 scoped subscription.
export const activeHistoryAtom = selectAtom(
  activeConversationAtom,
  (conv): Message[] => conv?.history ?? [],
);

// Whether the active conversation has NO messages. A boolean projection (not the
// array) so a subscriber (the MessageHistory loading gate) re-renders only when
// empty↔non-empty flips — NOT on every streamed frame that grows the history.
export const activeHistoryEmptyAtom = selectAtom(
  activeConversationAtom,
  (conv): boolean => (conv?.history.length ?? 0) === 0,
);

// The active conversation is streaming when ANY AI message is still in the
// `streaming` state. Scans the whole history (not just the tail): after a
// mid-stream reload, the resumed AI turn may not be the last row (a human send
// or a settled history row can sit below it), so a tail-only check would miss it
// and the composer would wrongly fall back to idle. (Mirrors legacy's
// `sections.some(s => s.status === Receiving)`.)
export const isStreamingAtom = atom<boolean>((get) => {
  const history = get(activeConversationAtom)?.history ?? [];
  return history.some(isStreamingAiMessage);
});

// The `↻` window: an AI placeholder exists in the `pending` state but the stream
// has not opened yet (created synchronously on click — before `onopen` — so
// thinking renders immediately while the button loads). Scans the whole history
// for the same reload-resilience reason as `isStreamingAtom`.
export const isRequestPendingAtom = atom<boolean>((get) => {
  const history = get(activeConversationAtom)?.history ?? [];
  return history.some(
    (m) => m.author === "ai" && m.streamingState === "pending",
  );
});

// Reader parameterized by `planId`. A factory (not one atom) because
// `selectAtom` memoizes a single selector — each `planId` needs its own.
// Three distinct mechanisms keep `PlanCard` from re-rendering needlessly
// (§6.E7), and they must not be conflated:
//   1. Value identity is the WRITER's doing: `use-plan` reconciles each poll
//      by id, and immer structural sharing leaves an unchanged node's `Plan`
//      reference intact across polls.
//   2. `selectAtom` scopes the subscription to that one node and, via its
//      `Object.is` output memo, skips notifying when the node is unchanged.
//   3. Each call mints a fresh atom instance, so the consumer must `useMemo`
//      it by `planId` to keep the subscription (and thus the memo) stable.
export const planByIdAtom = (planId: string): Atom<Plan | undefined> =>
  selectAtom(plansAtom, (plans): Plan | undefined => plans.get(planId));
