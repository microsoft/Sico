import { renderHook } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import { act, type PropsWithChildren, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeConversationIdAtom,
  type Conversation,
  conversationsAtom,
  type Message,
  plansAtom,
} from "@/features/chat/atoms/chat-atom";
import {
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { usePlan } from "@/features/chat/hooks/use-plan";
import {
  type Plan,
  type PlanStatus,
  PlanStatusSchema,
} from "@/features/chat/schemas/plan";
import { fetchPlan } from "@/features/chat/services/plan";
import { ApiClientProvider } from "@/services/api-client-context";

// Control `fetchPlan` per test, but keep the REAL `mergePlan` in the write path:
// the reference-stable merge is part of this hook's contract, so it must run for
// real (only the network boundary is stubbed).
vi.mock("@/features/chat/services/plan", async (importActual) => {
  const actual =
    await importActual<typeof import("@/features/chat/services/plan")>();
  return { ...actual, fetchPlan: vi.fn() };
});

// Stub only `toast.error` / `toast.dismiss` so the dedup-id assertion is
// observable; everything else in `@sico/ui` stays real.
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { error: vi.fn(), dismiss: vi.fn() } };
});

const apiClient = {} as AxiosInstance;

function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return (
      <JotaiProvider store={store}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </JotaiProvider>
    );
  };
}

// A minimal valid normalized Plan (planId = String(turnId)): one step, one tool
// call, one sub-call. Built fresh per call so every node is a distinct ref —
// `mergePlan` then proves identity is preserved only when content is unchanged.
// `status` defaults to RUNNING; pass a terminal code to exercise the
// plan-status self-stop (historical turns carry no streamingState).
function makePlan(
  turnId: number,
  status: PlanStatus = PlanStatusSchema.enum.RUNNING,
): Plan {
  return {
    planId: String(turnId),
    status,
    title: "Plan",
    steps: [
      {
        id: "0",
        title: "Step",
        status: 2, // PlanStepStatus.IN_PROGRESS
        toolCalls: [
          {
            toolCallId: "t1",
            toolName: "search",
            status: 1, // ToolCallStatus.RUNNING
            subCalls: [],
          },
        ],
      },
    ],
  };
}

const CLIENT_ID = "c1";

// A NO_PLAN plan as the schema actually normalizes a `{ status: 1 }` wire body
// (turns 14-18, agent 578): empty steps, empty planId — NOT makePlan's populated
// shape. The stop path keys off `status` alone, but mirroring the real shape
// keeps the fixture honest.
function makeNoPlan(): Plan {
  return {
    planId: "",
    status: PlanStatusSchema.enum.NO_PLAN,
    steps: [],
  };
}

// Seed (or update) an AI turn carrying a `plan` Part for `turnId` into the one
// active conversation, preserving any sibling turns already present (the
// per-turn-guard test needs two turns side by side).
function seedTurn(
  store: ReturnType<typeof createStore>,
  turnId: number,
  streamingState?: Message["streamingState"],
): void {
  const planId = String(turnId);
  const msg: Message = {
    id: `m${turnId}`,
    author: "ai",
    turnId,
    streamingState,
    content: [{ partId: `${planId}:0`, type: "plan", planId }],
  };
  const existing = store.get(conversationsAtom).get(CLIENT_ID);
  const others = (existing?.history ?? []).filter((m) => m.turnId !== turnId);
  const conv: Conversation = {
    clientId: CLIENT_ID,
    history: [...others, msg],
  };
  store.set(conversationsAtom, new Map([[CLIENT_ID, conv]]));
  store.set(activeConversationIdAtom, CLIENT_ID);
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Let queued microtasks (the post-await continuation of `tick`) run under fake
// timers, without advancing wall time.
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(fetchPlan).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePlan", () => {
  it("polls immediately on mount, then every 2000ms, merging by id", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    vi.mocked(fetchPlan).mockImplementation(async () => makePlan(5));

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // Immediate kick (legacy loopPlanStatus fetches once before the interval) —
    // a history plan card fills in ~1 round-trip, not after a 2s dead window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledWith(apiClient, {
      agentInstanceId: 7,
      turnId: 5,
      conversationId: 3,
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    expect(store.get(plansAtom).get("5")).toBeDefined();
    expect(store.get(plansAtom).get("5")?.planId).toBe("5");

    // Then it keeps polling on the 2s interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(2);
  });

  it("drops a stale RUNNING poll that resolves after the plan already reached a terminal status (no resurrection)", async () => {
    // The real race the guard must still cover: the poll self-stops when a fetch
    // returns COMPLETED (aborting + clearing the interval), but a DIFFERENT poll
    // already in flight then resolves with a stale RUNNING. The abort guard must
    // drop it so a finished plan is never flipped back to "in progress".
    const store = createStore();
    seedTurn(store, 5, "streaming");

    // Mount poll: in flight, unresolved (so a second poll can overlap it).
    const stale = deferred<Plan>();
    vi.mocked(fetchPlan).mockReturnValueOnce(stale.promise);
    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    // Next tick resolves COMPLETED → writes terminal, self-stops (aborts).
    vi.mocked(fetchPlan).mockResolvedValueOnce(
      makePlan(5, PlanStatusSchema.enum.COMPLETED),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(store.get(plansAtom).get("5")?.status).toBe(
      PlanStatusSchema.enum.COMPLETED,
    );

    // The original in-flight poll now resolves with a stale RUNNING — dropped by
    // the abort guard, so the terminal status stands.
    await act(async () => {
      stale.resolve(makePlan(5, PlanStatusSchema.enum.RUNNING));
    });
    await flush();
    expect(store.get(plansAtom).get("5")?.status).toBe(
      PlanStatusSchema.enum.COMPLETED,
    );
  });

  it("does NOT drop a poll for turn N when a DIFFERENT turn M is terminal (per-turn guard)", async () => {
    const store = createStore();
    // Two turns in the SAME conversation: M done, N streaming.
    seedTurn(store, 4, "done"); // M
    seedTurn(store, 5, "streaming"); // N
    vi.mocked(fetchPlan).mockImplementation(async () => makePlan(5));

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // N's poll merged — M being done is irrelevant to N's guard.
    expect(store.get(plansAtom).get("5")?.planId).toBe("5");
  });

  it("keeps polling after the SSE stream goes done while the plan is still non-terminal (COMPLETED lands AFTER done)", async () => {
    // Proven by real capture (turn 27): the plan reads RUNNING at stream-done,
    // then flips COMPLETED ~1s LATER. The poll must NOT stop on the SSE `done`
    // edge — only on the plan's OWN terminal status — or that late COMPLETED is
    // never fetched and the card/button freeze on "in progress".
    const store = createStore();
    seedTurn(store, 5, "streaming");
    vi.mocked(fetchPlan).mockImplementation(async () =>
      makePlan(5, PlanStatusSchema.enum.RUNNING),
    );

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // Immediate mount poll (RUNNING written).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    // The SSE stream finishes while the plan is still RUNNING.
    act(() => {
      seedTurn(store, 5, "done");
    });

    // The plan flips COMPLETED only on the NEXT poll, after stream-done.
    vi.mocked(fetchPlan).mockImplementation(async () =>
      makePlan(5, PlanStatusSchema.enum.COMPLETED),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // The poll kept running past `done` and captured the terminal status.
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(store.get(plansAtom).get("5")?.status).toBe(
      PlanStatusSchema.enum.COMPLETED,
    );
  });

  it("raises one deduped toast on poll failure, keeps rendered content, and keeps polling", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    const seeded = makePlan(5);
    store.set(plansAtom, new Map([["5", seeded]]));
    vi.mocked(fetchPlan).mockRejectedValue(new Error("boom"));

    const { toast } = await import("@sico/ui");

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // Two failed ticks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't update plan status"),
      { id: "plan-poll-error" },
    );
    // Failures don't touch the atom: the rendered plan is byte-for-byte the same
    // reference.
    expect(store.get(plansAtom).get("5")).toBe(seeded);

    // A failure does NOT stop the interval — a later tick still fetches. With
    // the immediate mount poll plus three interval ticks, that's four calls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(4);
  });

  it("keeps the plansAtom Map and the merged Plan reference-stable across an unchanged poll", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    // Every poll returns an EQUAL-but-fresh Plan (distinct refs): the real
    // mergePlan must collapse tick 2 to the tick-1 object, and writeMergedPlan
    // must then skip the store write entirely (no new Map).
    vi.mocked(fetchPlan).mockImplementation(async () => makePlan(5));

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // Tick 1 = the immediate mount poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const mapAfterTick1 = store.get(plansAtom);
    const planAfterTick1 = mapAfterTick1.get("5");
    expect(planAfterTick1?.planId).toBe("5");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    // Unchanged second poll: same Map ref (no clone) and same Plan ref (no
    // re-mint) — the §6.E7 render gate that lets React.memo skip the subtree.
    expect(store.get(plansAtom)).toBe(mapAfterTick1);
    expect(store.get(plansAtom).get("5")).toBe(planAfterTick1);
  });

  it("still polls a turn whose SSE stream is already done at mount, until the plan's own status is terminal", async () => {
    // A history-hydrated turn carries `done`, but the plan tree is NOT in the
    // store yet (history hands a pointer only). The poll must run to fetch the
    // plan's real status — keying the mount guard off the SSE `done` (as before)
    // would leave the card empty forever. It self-stops once the fetched plan is
    // terminal.
    const store = createStore();
    seedTurn(store, 5, "done");
    vi.mocked(fetchPlan).mockResolvedValue(
      makePlan(5, PlanStatusSchema.enum.COMPLETED),
    );

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // Immediate mount poll fetches the terminal plan and writes it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    expect(store.get(plansAtom).get("5")?.status).toBe(
      PlanStatusSchema.enum.COMPLETED,
    );

    // Terminal plan → interval cleared, no further polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  it("self-stops once the fetched plan status is terminal, even when the turn never goes terminal (historical turn)", async () => {
    // A history-hydrated plan turn carries NO streamingState (msg.proto has no
    // such field), so the message-terminal guard never fires. Without a
    // plan-status guard the 2s poll would run forever. The plan's own status
    // reaching COMPLETED must stop it.
    const store = createStore();
    seedTurn(store, 5, undefined);
    vi.mocked(fetchPlan).mockResolvedValue(
      makePlan(5, PlanStatusSchema.enum.COMPLETED),
    );

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // First tick fetches the terminal plan and merges it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    expect(store.get(plansAtom).get("5")?.status).toBe(
      PlanStatusSchema.enum.COMPLETED,
    );

    // The interval is now cleared: no further fetch on the next tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  it("self-stops on NO_PLAN for a HISTORICAL turn (no streamingState) — a plan-less past turn must not poll forever", async () => {
    // Real capture (turns 14-18, agent 578): a historical turn whose plan part
    // resolves to `{ status: 1 }` (NO_PLAN) with no plan body. For a history
    // turn (streamingState === undefined) there is no live producer that will
    // ever fill the tree, so NO_PLAN is settled — stop, exactly like a terminal
    // status, or every plan-less past turn polls every 2s forever. (`use-plan`
    // is the SOLE writer of `plansAtom`, so leaving the interval alive is waste.)
    const store = createStore();
    seedTurn(store, 5, undefined);
    vi.mocked(fetchPlan).mockResolvedValue(makeNoPlan());

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    // Interval cleared on NO_PLAN: the next tick does not fetch again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });

  it("KEEPS polling on NO_PLAN for a LIVE turn (streaming) — a transient NO_PLAN before the tree forms must not kill the poll", async () => {
    // The mirror of the historical case. A LIVE turn (streamingState present)
    // mounts the poll the instant its PLAN frame arrives; the backend may answer
    // the first `/plan` with a transient NO_PLAN before the tree is queryable.
    // Stopping there would freeze the card forever (sole writer of plansAtom,
    // and the effect never restarts — turnId is stable). So a NON-historical
    // turn must keep polling through NO_PLAN until a real status lands. This
    // preserves legacy/dwp-frontend semantics (`if (!plan) return true`).
    const store = createStore();
    seedTurn(store, 5, "streaming");
    // Tick 1 → transient NO_PLAN (tree not ready); tick 2 → RUNNING (tree forms).
    vi.mocked(fetchPlan)
      .mockResolvedValueOnce(makeNoPlan())
      .mockResolvedValue(makePlan(5, PlanStatusSchema.enum.RUNNING));

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    // First poll returns NO_PLAN — but the turn is live, so the poll continues.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);

    // The next tick still fires (NOT stopped) and now fetches the RUNNING tree.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(2);
    expect(store.get(plansAtom).get("5")?.status).toBe(
      PlanStatusSchema.enum.RUNNING,
    );
  });

  it("drops a poll result that resolves after the hook unmounts", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    const d = deferred<Plan>();
    vi.mocked(fetchPlan).mockReturnValue(d.promise);

    const { unmount } = renderHook(() => usePlan(7, 5, 3), {
      wrapper: wrapper(store),
    });

    // The immediate mount poll is in flight; unmount before it resolves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
    unmount();

    // The late resolve must be dropped (cleanup aborted the controller).
    await act(async () => {
      d.resolve(makePlan(5));
    });
    await flush();
    expect(store.get(plansAtom).has("5")).toBe(false);
  });

  it("dismisses a lingering poll-error toast when the hook unmounts", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    vi.mocked(fetchPlan).mockRejectedValue(new Error("boom"));

    const { toast } = await import("@sico/ui");

    const { unmount } = renderHook(() => usePlan(7, 5, 3), {
      wrapper: wrapper(store),
    });

    // A failed tick raises the deduped "Retrying…" toast.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(toast.error).toHaveBeenCalled();

    // Unmounting while it's showing must clear it eagerly — the same dismiss the
    // self-stop path does — so the toast lifecycle is bounded by the poll's, not
    // left to auto-expire after the owner is gone.
    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith("plan-poll-error");
  });

  // A plan whose tool call carries an ACQUIRED_SANDBOX (wire type 5) deliverable.
  function makePlanWithSandbox(
    turnId: number,
    status: PlanStatus = PlanStatusSchema.enum.RUNNING,
  ): Plan {
    return {
      planId: String(turnId),
      status,
      title: "Plan",
      steps: [
        {
          id: "0",
          title: "Step",
          status: 2,
          toolCalls: [
            {
              toolCallId: "t1",
              toolName: "acquire_device",
              status: 1,
              deliverables: [{ type: 5, acquiredSandbox: {} }],
              subCalls: [],
            },
          ],
        },
      ],
    };
  }

  it("auto-opens the sandbox sidepane when a RUNNING plan acquires a device", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    // A prior previewer left the pane maximized — the auto-open must clear it.
    store.set(sidepaneMaximizedAtom, true);
    vi.mocked(fetchPlan).mockImplementation(async () => makePlanWithSandbox(5));

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "sandbox",
      agentInstanceId: 7,
    });
    // Mirrors `open()`: a freshly auto-opened pane never inherits maximize state.
    expect(store.get(sidepaneMaximizedAtom)).toBe(false);
  });

  it("does not auto-open when the acquiring plan is not RUNNING", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    vi.mocked(fetchPlan).mockImplementation(async () =>
      makePlanWithSandbox(5, PlanStatusSchema.enum.COMPLETED),
    );

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(store.get(sidepaneContentAtom)).toBeNull();
  });

  it("auto-opens only once — a closed pane stays closed across later polls", async () => {
    const store = createStore();
    seedTurn(store, 5, "streaming");
    vi.mocked(fetchPlan).mockImplementation(async () => makePlanWithSandbox(5));

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // User closes the auto-opened pane.
    store.set(sidepaneContentAtom, null);

    // The next poll still sees the same acquiring plan, but must NOT reopen it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(store.get(sidepaneContentAtom)).toBeNull();
  });

  it("does NOT poll when it mounts over an already-terminal seeded plan (history inline)", async () => {
    const store = createStore();
    seedTurn(store, 5, undefined); // historical turn, no streamingState
    // The plan is already seeded terminal by use-history — no fetch should fire.
    store.set(
      plansAtom,
      new Map([["5", makePlan(5, PlanStatusSchema.enum.COMPLETED)]]),
    );

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchPlan).not.toHaveBeenCalled();
  });

  it("DOES poll when it mounts over a seeded NON-terminal plan (still running at reload)", async () => {
    const store = createStore();
    seedTurn(store, 5, undefined);
    store.set(
      plansAtom,
      new Map([["5", makePlan(5, PlanStatusSchema.enum.RUNNING)]]),
    );
    vi.mocked(fetchPlan).mockResolvedValue(
      makePlan(5, PlanStatusSchema.enum.RUNNING),
    );

    renderHook(() => usePlan(7, 5, 3), { wrapper: wrapper(store) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchPlan).toHaveBeenCalledTimes(1);
  });
});
