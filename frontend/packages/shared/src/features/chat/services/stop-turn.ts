import { type createStore } from "jotai";

import { logger } from "../../../utils/logger";
import {
  activeConversationAtom,
  type Conversation,
  isStreamingAiMessage,
} from "../atoms/chat-atom";

type Store = ReturnType<typeof createStore>;

// Generic non-fatal connection-error toast. A failed `POST /plan/cancel`
// leaves the turn running, so the user keeps the "try again" affordance.
const STOP_FAILED_COPY =
  "There's been a connection error. Please try again later.";

export type StopTurnContext = {
  // Injected to keep the orchestration a pure, testable fn. Takes the numeric
  // turnId. Despite the `/plan/cancel` name, the backend cancels the whole
  // TURN's task runtime by turnId (not just a plan) — see the core
  // `cancel_turn_task_runtime_once` call — so this stops a plain text stream too.
  cancelPlan: (turnId: number) => Promise<void>;
  // The reconnect manager's hard idle exit. Stop routes through it on EVERY
  // path: a bare `abort()` reads as a transport close → backoff → reopen, so
  // the loop would fight the user's Stop. `stop()` flips the exiting flag first.
  reconnectStop: () => void;
  toastError: (message: string) => void;
};

// The in-flight turn's server turnId, if any. The SSE stream stays open for the
// whole turn (plan execution OR a plain text stream), so a live turn's AI
// message is always still `streaming` here and carries its `turnId`.
function streamingTurnId(conv: Conversation | undefined): number | undefined {
  return conv?.history.find(isStreamingAiMessage)?.turnId;
}

// Stop the active turn. Any in-flight turn → `POST /plan/cancel` FIRST (the
// backend cancels the turn's task runtime by turnId — text streams included —
// so aborting the transport before that would orphan a running turn on the
// server, and a reload's reconnect probe would resume it). Keying on the turn's
// `turnId` (not on a plan Part) is deliberate: a plain text stream has a turnId
// but no plan, and it must be cancelled too. On cancel failure, toast and leave
// the turn running so the user keeps the retry affordance.
//
// Teardown order is load-bearing: `reconnectStop()` BEFORE `abort()`, so the
// abort echo resolves to a clean idle and then drives `sendMessage` to mark the
// partial turn done. Settling the AI message to `done` is event-driven by the
// stream's own lifecycle (a normal send's `sendMessage` closure on the abort
// echo, or the reconnect machine's terminal `settle`) — Stop just tears the
// transport down.
export async function stopTurn(
  store: Store,
  ctx: StopTurnContext,
): Promise<void> {
  const conv = store.get(activeConversationAtom);
  const turnId = streamingTurnId(conv);

  if (turnId !== undefined) {
    try {
      await ctx.cancelPlan(turnId);
    } catch (err) {
      logger.warn("chat: turn cancel failed on stop", { err });
      ctx.toastError(STOP_FAILED_COPY);
      return;
    }
  }

  ctx.reconnectStop();
  conv?.sendHandle?.abort();
}
