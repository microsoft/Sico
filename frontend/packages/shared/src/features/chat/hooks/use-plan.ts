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
import type { AxiosInstance } from "axios";
import { type createStore, useStore } from "jotai";
import { useEffect, useRef } from "react";

import { useApiClient } from "../../../services/api-client-context";
import { logger } from "../../../utils/logger";
import { activeConversationAtom, plansAtom } from "../atoms/chat-atom";
import { openSidepane } from "../atoms/sidepane-atom";
import { type Plan, type PlanStatus, PlanStatusSchema } from "../schemas/plan";
import { fetchPlan, mergePlan } from "../services/plan";
import { hasAcquiredSandbox } from "../utils/deliverable";

type Store = ReturnType<typeof createStore>;

const PLAN_POLL_INTERVAL_MS = 2000;
// Stable id → sonner dedups repeated failures into one toast, and
// `toast.dismiss(id)` clears it when polling ends.
const PLAN_POLL_TOAST_ID = "plan-poll-error";
const PLAN_POLL_FAILED_COPY = "Couldn't update plan status. Retrying…";

// Walk a plan's tool-call forest (steps → toolCalls → subCalls) for any
// deliverable that signals an acquired sandbox. Recursion mirrors the wire's
// nested `subCalls`; a `display`-only step with no calls contributes nothing.
function planAcquiresSandbox(plan: Plan): boolean {
  const callHasSandbox = (
    call: Plan["steps"][number]["toolCalls"][number],
  ): boolean =>
    hasAcquiredSandbox(call.deliverables ?? []) ||
    call.subCalls.some(callHasSandbox);
  return plan.steps.some((step) => step.toolCalls.some(callHasSandbox));
}

// Auto-open the sandbox sidepane the first time a RUNNING plan acquires a
// device. One-shot per turn via `openedRef` (a user who closes it must not have
// it yank back on the next poll). Delegates the content+maximize write to
// `openSidepane` so it can't drift from `useSidepane().open()` (MP13). MI11-
// compliant: atom state, not an imperative ref.
function autoOpenSandboxIfAcquired(
  store: Store,
  agentInstanceId: number,
  openedRef: { current: boolean },
  plan: Plan,
): void {
  if (
    openedRef.current ||
    plan.status !== PlanStatusSchema.enum.RUNNING ||
    !planAcquiresSandbox(plan)
  ) {
    return;
  }
  openedRef.current = true;
  openSidepane(store, { kind: "sandbox", agentInstanceId });
}

// A plan whose OWN status is terminal is finished executing — it stops the poll
// regardless of the turn's SSE stream (the stream closes before the plan
// finishes). Covers both live and history-hydrated turns.
const TERMINAL_PLAN_STATUSES: ReadonlySet<PlanStatus> = new Set([
  PlanStatusSchema.enum.COMPLETED,
  PlanStatusSchema.enum.FAILED,
  PlanStatusSchema.enum.REQUIRE_HUMAN_INPUT,
  PlanStatusSchema.enum.CANCELLED,
]);

// When the poll stops. Terminal always stops. NO_PLAN stops ONLY for a
// historical turn (one with no live producer): a plan-less past turn would
// otherwise poll every 2s forever (nothing else fills plansAtom for it — this
// poll is its only writer, and history seeds only turns that DID inline a plan).
// A LIVE turn must keep polling through a transient NO_PLAN — the backend can
// answer the first `/plan` with NO_PLAN before the tree is queryable, and
// stopping there would freeze the card with no recovery (the effect never
// restarts — turnId is stable). This mirrors legacy/dwp-frontend, which
// continued on a missing plan body (`if (!plan) return true`).
function shouldStopPolling(status: PlanStatus, isHistorical: boolean): boolean {
  if (TERMINAL_PLAN_STATUSES.has(status)) {
    return true;
  }
  return isHistorical && status === PlanStatusSchema.enum.NO_PLAN;
}

// A turn is "historical" iff its message carries NO streamingState: history
// hydration sets none, while a live turn is minted with pending/streaming and
// settles to done/error. The distinction is what separates a settled plan-less
// past turn (stop on NO_PLAN) from a still-forming live one (keep polling).
function isHistoricalTurn(store: Store, turnId: number): boolean {
  const history = store.get(activeConversationAtom)?.history ?? [];
  const message = history.find((m) => m.turnId === turnId);
  return message?.streamingState === undefined;
}

// The poll's write of `plansAtom`: merge `fresh` into the stored plan by id.
// `mergePlan` returns `prev` itself when nothing changed, so an all-unchanged
// poll skips the write (Map ref stays stable — no spurious re-render).
function writeMergedPlan(store: Store, planId: string, fresh: Plan): void {
  const prevMap = store.get(plansAtom);
  const prevPlan = prevMap.get(planId);
  const nextPlan = prevPlan ? mergePlan(prevPlan, fresh) : fresh;
  if (nextPlan === prevPlan) {
    return;
  }
  const nextMap = new Map(prevMap);
  nextMap.set(planId, nextPlan);
  store.set(plansAtom, nextMap);
}

type PollContext = {
  store: Store;
  apiClient: AxiosInstance;
  agentInstanceId: number;
  turnId: number;
  conversationId: number;
  planId: string;
  controller: AbortController;
  // Tear down the interval the instant a fetched plan reaches a terminal status
  // and abort the controller so any overlapping in-flight poll is dropped.
  stop: () => void;
  // Auto-open the sandbox sidepane the first time a RUNNING plan acquires a
  // device (legacy parity, MI11-compliant: sets atom state, the Sidepane
  // reacts — no imperative drawer ref). Idempotent via the caller's ref.
  maybeAutoOpenSandbox: (plan: Plan) => void;
};

// One poll: fetch, then the resurrection guard before writing. `stop()` aborts
// SYNCHRONOUSLY when an earlier poll wrote a terminal status, so any poll
// resolving afterwards is dropped here — a stale RUNNING never overwrites a
// finished plan. A failure neither stops the interval nor touches the atom:
// toast (deduped under a stable id) and let the next tick retry.
async function pollOnce(ctx: PollContext): Promise<void> {
  const {
    store,
    apiClient,
    agentInstanceId,
    turnId,
    conversationId,
    planId,
    controller,
    stop,
    maybeAutoOpenSandbox,
  } = ctx;
  try {
    const fresh = await fetchPlan(apiClient, {
      agentInstanceId,
      turnId,
      conversationId,
    });
    // Resurrection guard: `stop()` aborts SYNCHRONOUSLY on an earlier terminal
    // write, so a poll resolving afterwards observes `aborted` and is dropped.
    if (controller.signal.aborted) {
      return;
    }
    writeMergedPlan(store, planId, fresh);
    maybeAutoOpenSandbox(fresh);
    // Self-stop on a stopping status (terminal always; NO_PLAN only for a
    // historical turn) — the ONLY exit. Stop AFTER the write so the final state
    // renders before teardown.
    if (shouldStopPolling(fresh.status, isHistoricalTurn(store, turnId))) {
      stop();
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return;
    }
    logger.warn("chat: plan poll failed", { err });
    toast.error(PLAN_POLL_FAILED_COPY, { id: PLAN_POLL_TOAST_ID });
  }
}

// Start polling a turn's plan: kicks once immediately, then every 2s, and wires
// a `stop()` that clears the interval + aborts. Returns a teardown to run on
// unmount. Extracted from `usePlan`'s effect to keep that hook within the
// per-function line budget.
function beginPlanPoll(
  base: Omit<PollContext, "controller" | "stop" | "maybeAutoOpenSandbox">,
  autoOpenedRef: { current: boolean },
): () => void {
  const controller = new AbortController();
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const teardown = (): void => {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
    controller.abort();
    // Bound the poll-error toast to the poll's lifetime, so unmounting mid-retry
    // never leaves a "Retrying…" toast orphaned.
    toast.dismiss(PLAN_POLL_TOAST_ID);
  };

  // History seeds a plan already terminal → its tree is final, nothing to poll
  // for, so skip the kick + interval (teardown is still a harmless no-op abort).
  const seeded = base.store.get(plansAtom).get(base.planId);
  if (seeded !== undefined && TERMINAL_PLAN_STATUSES.has(seeded.status)) {
    return teardown;
  }

  const ctx: PollContext = {
    ...base,
    controller,
    stop: teardown,
    maybeAutoOpenSandbox: (plan) =>
      autoOpenSandboxIfAcquired(
        base.store,
        base.agentInstanceId,
        autoOpenedRef,
        plan,
      ),
  };
  // Kick once immediately so a history plan card doesn't sit empty for a full 2s
  // before its first tree arrives; the interval then refreshes on the beat.
  void pollOnce(ctx);
  intervalId = setInterval(() => {
    void pollOnce(ctx);
  }, PLAN_POLL_INTERVAL_MS);
  return teardown;
}

// The sole poller of `GET /plan` and the live-poll writer of `plansAtom` for one
// turn (history seeds the same Map if-absent before this mounts). Polls every 2s
// and merges by id, then self-stops when the plan goes terminal. The controller
// is an in-process drop flag ("ignore a stale resolution"), not an axios cancel
// (`fetchPlan` takes no signal).
export function usePlan(
  agentInstanceId: number,
  turnId: number,
  conversationId: number,
): void {
  const store = useStore();
  const apiClient = useApiClient();
  // One auto-open per turn (legacy `lastAutoOpenedSandboxIdRef` intent): a ref
  // so it survives re-renders without re-arming the effect.
  const autoOpenedRef = useRef(false);

  useEffect(
    () =>
      beginPlanPoll(
        {
          store,
          apiClient,
          agentInstanceId,
          turnId,
          conversationId,
          planId: String(turnId),
        },
        autoOpenedRef,
      ),
    [store, apiClient, agentInstanceId, turnId, conversationId],
  );
}
