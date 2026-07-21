import { type createStore } from "jotai";

import { logger } from "../../../utils/logger";
import {
  activeConversationAtom,
  type Conversation,
  isStreamingAiMessage,
  type Part,
} from "../atoms/chat-atom";

type Store = ReturnType<typeof createStore>;

// Generic non-fatal connection-error toast. A failed `POST /plan/cancel`
// leaves the turn running, so the user keeps the "try again" affordance.
const STOP_FAILED_COPY =
  "There's been a connection error. Please try again later.";

export type StopTurnContext = {
  // Injected to keep the orchestration a pure, testable fn. Takes the numeric
  // turnId (= Number(planId)).
  cancelPlan: (turnId: number) => Promise<void>;
  // The reconnect manager's hard idle exit. Stop routes through it on EVERY
  // path: a bare `abort()` reads as a transport close → backoff → reopen, so
  // the loop would fight the user's Stop. `stop()` flips the exiting flag first.
  reconnectStop: () => void;
  toastError: (message: string) => void;
};

// The `plan` Part of the in-flight turn, if any — the plan-vs-text
// discriminator for Stop. The SSE stream stays open for the whole plan
// execution, so a RUNNING plan's turn is always still `streaming` here.
function streamingPlanPart(
  conv: Conversation | undefined,
): Extract<Part, { type: "plan" }> | undefined {
  const ai = conv?.history.find(isStreamingAiMessage);
  return ai?.content.find(
    (p): p is Extract<Part, { type: "plan" }> => p.type === "plan",
  );
}

// Stop the active turn. Plan in progress → `POST /plan/cancel` FIRST (aborting
// the stream before the backend cancels would orphan a running plan); on
// failure toast and leave the turn running. Teardown order is load-bearing:
// `reconnectStop()` BEFORE `abort()`, so the abort echo resolves to a clean
// idle and then drives `sendMessage` to mark the partial turn done.
//
// Settling the AI message to `done` is NOT done here — it is event-driven by the
// stream's own lifecycle: a normal send's `sendMessage` closure marks it on the
// abort echo, and a reconnect-resumed turn is marked by the reconnect machine's
// terminal `settle` command (use-reconnect). Stop just tears the transport down.
export async function stopTurn(
  store: Store,
  ctx: StopTurnContext,
): Promise<void> {
  const conv = store.get(activeConversationAtom);
  const planPart = streamingPlanPart(conv);

  if (planPart) {
    try {
      await ctx.cancelPlan(Number(planPart.planId));
    } catch (err) {
      logger.warn("chat: plan cancel failed on stop", { err });
      ctx.toastError(STOP_FAILED_COPY);
      return;
    }
  }

  ctx.reconnectStop();
  conv?.sendHandle?.abort();
}
