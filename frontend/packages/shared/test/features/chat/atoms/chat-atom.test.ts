import { produce } from "immer";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  isRequestPendingAtom,
  isStreamingAtom,
  type Part,
  planByIdAtom,
  plansAtom,
} from "@/features/chat/atoms/chat-atom";
import { type Plan } from "@/features/chat/schemas/plan";

function seed(store: ReturnType<typeof createStore>, conv: Conversation): void {
  store.set(
    conversationsAtom,
    produce(store.get(conversationsAtom), (draft) => {
      draft.set(conv.clientId, conv);
    }),
  );
  store.set(activeConversationIdAtom, conv.clientId);
}

describe("chat-atom derived states", () => {
  it("is idle when there is no active conversation", () => {
    const store = createStore();
    expect(store.get(isStreamingAtom)).toBe(false);
    expect(store.get(isRequestPendingAtom)).toBe(false);
  });

  it("is request-pending: AI tail in the pending state (placeholder created on click, before onopen)", () => {
    const store = createStore();
    seed(store, {
      clientId: "c1",
      history: [
        { id: "m1", author: "human", content: [] },
        { id: "m2", author: "ai", content: [], streamingState: "pending" },
      ],
      sendHandle: new AbortController(),
    });
    expect(store.get(isRequestPendingAtom)).toBe(true);
    expect(store.get(isStreamingAtom)).toBe(false);
  });

  it("is streaming when the AI tail is streamingState=streaming", () => {
    const store = createStore();
    seed(store, {
      clientId: "c1",
      history: [
        { id: "m1", author: "human", content: [] },
        { id: "m2", author: "ai", content: [], streamingState: "streaming" },
      ],
      sendHandle: new AbortController(),
    });
    expect(store.get(isStreamingAtom)).toBe(true);
    expect(store.get(isRequestPendingAtom)).toBe(false);
  });

  // Mid-stream reload: the resumed streaming AI turn need not be the tail — a
  // human send or a settled history row can sit below it. Scan the whole
  // history so the composer still reads streaming (a tail-only check missed it,
  // wrongly falling back to idle).
  it("is streaming when a NON-tail AI message is streaming (reload resilience)", () => {
    const store = createStore();
    seed(store, {
      clientId: "c1",
      history: [
        { id: "m1", author: "human", content: [] },
        { id: "m2", author: "ai", content: [], streamingState: "streaming" },
        { id: "m3", author: "human", content: [] },
      ],
      sendHandle: new AbortController(),
    });
    expect(store.get(isStreamingAtom)).toBe(true);
  });

  it("is request-pending when a NON-tail AI message is pending (reload resilience)", () => {
    const store = createStore();
    seed(store, {
      clientId: "c1",
      history: [
        { id: "m1", author: "ai", content: [], streamingState: "pending" },
        { id: "m2", author: "human", content: [] },
      ],
      sendHandle: new AbortController(),
    });
    expect(store.get(isRequestPendingAtom)).toBe(true);
  });

  it("is idle again once the AI tail is terminal (done) — handle cleared", () => {
    const store = createStore();
    seed(store, {
      clientId: "c1",
      history: [
        { id: "m1", author: "human", content: [] },
        { id: "m2", author: "ai", content: [], streamingState: "done" },
      ],
      sendHandle: undefined,
    });
    expect(store.get(isStreamingAtom)).toBe(false);
    expect(store.get(isRequestPendingAtom)).toBe(false);
  });

  it("returns to idle after abort-before-onopen: human tail (placeholder removed), handle cleared", () => {
    const store = createStore();
    seed(store, {
      clientId: "c1",
      history: [{ id: "m1", author: "human", content: [] }],
      sendHandle: undefined,
    });
    expect(store.get(isRequestPendingAtom)).toBe(false);
    expect(store.get(isStreamingAtom)).toBe(false);
  });
});

describe("chat-atom plan + reconnect store", () => {
  it("Part is a discriminated union over text|plan", () => {
    const text: Part = { partId: "a", type: "text", text: "hi" };
    const plan: Part = { partId: "b", type: "plan", planId: "p1" };
    expect(text.type).toBe("text");
    expect(plan.type).toBe("plan");
  });

  // planByIdAtom is a factory: it returns the by-id node so the reader keeps
  // reference identity across polls when that node is unchanged (§6.E7).
  it("planByIdAtom reads the by-id node and returns undefined for a miss", () => {
    const store = createStore();
    const plan: Plan = { planId: "7", status: 2, steps: [] };
    store.set(plansAtom, new Map([[plan.planId, plan]]));
    expect(store.get(planByIdAtom("7"))).toBe(plan);
    expect(store.get(planByIdAtom("nope"))).toBeUndefined();
  });

  // §6.E7 reference stability: an unrelated node update (immer structural
  // sharing) leaves the untouched node's reference intact, so a reader of
  // node "7" sees the SAME Plan across the poll — no needless PlanCard render.
  it("planByIdAtom keeps the node reference stable across an unrelated update", () => {
    const store = createStore();
    const plan: Plan = { planId: "7", status: 2, steps: [] };
    store.set(plansAtom, new Map([[plan.planId, plan]]));
    const before = store.get(planByIdAtom("7"));
    store.set(
      plansAtom,
      produce(store.get(plansAtom), (draft) => {
        draft.set("8", { planId: "8", status: 2, steps: [] });
      }),
    );
    expect(store.get(planByIdAtom("7"))).toBe(before);
  });
});
