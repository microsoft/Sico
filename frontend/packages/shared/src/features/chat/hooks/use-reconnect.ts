import { toast } from "@sico/ui";
import { type createStore, useStore } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { isAuthenticatedAtom, logoutAtom } from "../../../atoms/auth-atom";
import { useSicoConfig } from "../../../services/sico-config-context";
import { assertNever } from "../../../utils/assert-never";
import {
  activeConversationAtom,
  isStreamingAiMessage,
  isStreamingAtom,
  lastActivityAtom,
} from "../atoms/chat-atom";
import { HANDOFF_ABORT_REASON, SEND_FAILED_COPY } from "../constants";
import { type ChatEvent } from "../schemas/chat-event";
import { resolveChatEndpoints } from "../services/chat-endpoints";
import {
  type Command,
  initialState,
  type ReconnectEvent,
  type ReconnectMachineState,
  reduce,
} from "../services/reconnect";
import {
  ChatStreamHttpError,
  openReconnectStream,
} from "../services/reconnect-stream";
import { settleTurn } from "../services/replay";

type Store = ReturnType<typeof createStore>;

const RECONNECT_TOAST_COPY = "Reconnecting…";
// Stable id → sonner keeps ONE persistent toast for the whole drop episode (the
// machine's `toastShown` gate raises it once), and dismiss clears it on exit.
const RECONNECT_TOAST_ID = "chat-reconnect";
// Stall watchdog: a stream open but silent past this window is a zombie — abort
// and reopen. A real keepalive (`onLive`) re-arms it, so a quiet-but-alive
// stream is never killed.
const STALL_TIMEOUT_MS = 20000;
// Staleness gate for the live-send→reconnect hand-off. A turn is `streaming` but
// no frame has stamped `lastActivityAtom` within this window ⇒ its live stream
// is presumed dead (screen sleep / laptop lid), so a wake trigger resumes it
// over the reconnect transport. The bound is the backend KEEPALIVE CADENCE: the
// server sends keepalives well inside 20s (the same contract the stall watchdog
// above relies on), and `onLive` stamps the clock on every one — so a healthy
// stream, even a quiet one mid-plan-step, never looks stale. Aligned to the
// stall watchdog's 20s rather than a tighter value, so the two share ONE
// keepalive contract; a value under the cadence would abort a live-but-quiet
// stream. A false hand-off is only churn + a toast flash, not corruption
// (reset-then-replay rebuilds the turn's row from head), but staying at the
// documented bound avoids even that.
const STALE_ACTIVITY_MS = 20000;
// Periodic self-check for a silent drop that fires NO DOM event (pure display
// sleep). On wake the OS resumes this interval; its next tick sees the stale
// clock and resumes. 30s matches legacy's heartbeat.
const HEARTBEAT_MS = 30000;

type UseReconnectOptions = {
  // In isolation an omitted handler is a correct no-op — the machine still
  // coalesces the buffer.
  onReplay?: (events: ChatEvent[]) => void;
  // Fired once when a reconnect-resumed turn reaches a terminal state, symmetric
  // with the live-send path's `onSettle` (chat.ts). The caller invalidates the
  // history cache so a later remount refetches the now-persisted turn instead of
  // the pre-reload page-1 cache, which is missing the resumed turn.
  onSettle?: () => void;
};

// The imperative side of the reconnect loop, one instance per mount. Owns the
// AbortController, backoff/stall timers, and transport, translating their
// callbacks into the pure machine's vocabulary (`dispatch`) and executing the
// commands it emits (`runCommand`). All policy lives in the machine; this class
// is only effects. (A class, not a closure, keeps each step a small method —
// sidestepping both max-lines-per-function and the param-reassign a shared
// mutable context object would trip.)
class ReconnectController {
  private state: ReconnectMachineState = initialState();
  private controller?: AbortController;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private backoffTimer?: ReturnType<typeof setTimeout>;
  // Close-echo asymmetry: terminal teardowns (done/http401/unmount) drop the
  // loop, so the natural close they trigger must NOT re-enter the retry path.
  // `stop` deliberately leaves this false — it stays wired so its abort echo is
  // absorbed as a clean idle by the machine.
  private terminated = false;

  constructor(
    private readonly store: Store,
    // The resume target: the agent instance and (dwp multi-conversation) the
    // conversation id. `conversationId` is undefined for sico (v1), where the
    // backend resumes the single implicit conversation. Bundled so the payload
    // is spread straight through.
    private readonly target: {
      agentInstanceId: number;
      conversationId?: number;
    },
    // Lazy reads, bundled into one param (constructor cap is 4). All are read at
    // use time (replay / settle / openStream), never stored, so a changing
    // callback or config identity never re-arms the effect / tears down the loop.
    private readonly getters: {
      onReplay: () => ((events: ChatEvent[]) => void) | undefined;
      onSettle: () => (() => void) | undefined;
      reconnectUrl: () => string;
    },
  ) {}

  // Feed one event through the pure machine, then run the emitted commands.
  dispatch = (event: ReconnectEvent): void => {
    if (
      event.type === "done" ||
      event.type === "error" ||
      event.type === "http401" ||
      event.type === "unmount"
    ) {
      // Terminal teardowns: the loop is dropping, so the stream's natural close
      // must NOT re-enter the retry path (a `close` fed to a fresh idle state
      // would re-arm the loop — see the close-echo invariant). `error` is
      // terminal like `done`: a turn that failed shouldn't be reconnected.
      this.terminated = true;
    }
    const step = reduce(this.state, event);
    this.state = step.next;
    for (const command of step.commands) {
      this.runCommand(command);
    }
  };

  private runCommand(command: Command): void {
    switch (command.type) {
      case "openStream":
        this.openStream();
        return;
      case "scheduleBackoff":
        this.clearBackoff();
        this.backoffTimer = setTimeout(
          () => this.dispatch({ type: "backoffTick" }),
          command.ms,
        );
        return;
      case "armStall":
        this.clearStall();
        this.stallTimer = setTimeout(
          () => this.dispatch({ type: "stallTimeout" }),
          STALL_TIMEOUT_MS,
        );
        return;
      case "clearStall":
        this.clearStall();
        return;
      case "abort":
        this.controller?.abort();
        return;
      case "showToast":
        toast.loading(RECONNECT_TOAST_COPY, {
          id: RECONNECT_TOAST_ID,
          duration: Infinity,
        });
        return;
      case "dismissToast":
        toast.dismiss(RECONNECT_TOAST_ID);
        return;
      case "logout":
        this.store.set(logoutAtom);
        return;
      case "idle":
        // A terminal exit cancels any pending backoff so a stale tick never
        // reopens.
        this.clearBackoff();
        return;
      case "replay":
        this.getters.onReplay()?.(command.events);
        return;
      case "settle":
        this.settle(command);
        return;
      default:
        assertNever(command);
    }
  }

  // A reconnect-resumed turn has no `sendMessage` closure to mark it done; the
  // machine's terminal event (done/error frame, user stop) drives the settle
  // here, symmetric with the live-send path. An `error` settle also raises the
  // failure toast (parity with chat.ts's error branch). `onSettle` invalidates
  // history on every terminal state (done + error), matching chat.ts's onSettle.
  private settle(command: Extract<Command, { type: "settle" }>): void {
    settleTurn(this.store, command.turnId, command.state);
    if (command.state === "error") {
      toast.error(SEND_FAILED_COPY);
    }
    this.getters.onSettle()?.();
  }

  // Open a fresh stream under a new controller. The promise settles on clean
  // close / caller-abort and rejects on failure; both feed the machine — guarded
  // by controller identity so a superseded stream's late settle is ignored.
  private openStream(): void {
    const own = new AbortController();
    this.controller = own;
    this.terminated = false;
    void openReconnectStream(
      // `target` is exactly the payload shape (agentInstanceId + optional
      // conversationId), so spread it straight through.
      { ...this.target },
      {
        url: this.getters.reconnectUrl(),
        signal: own.signal,
        onOpen: () => this.dispatch({ type: "open" }),
        // `onLive` fires on every frame (keepalive included) — pure liveness.
        onLive: () => {
          // Keep the shared activity clock fresh so the hook's staleness
          // watchdog treats an active reconnect stream as alive (symmetric with
          // the live-send path stamping in chat.ts).
          this.store.set(lastActivityAtom, Date.now());
          this.dispatch({ type: "keepalive" });
        },
        onEvent: (event) => {
          // Terminal frames drive the settle path (symmetric with done); a
          // data frame appends to the replay buffer. An error frame carries no
          // Part (reduceFrame ignores it), so routing it to `error` rather than
          // `frame` loses nothing and keeps the terminal handling in one place.
          if (event.event === "done") {
            this.dispatch({ type: "done", event });
          } else if (event.event === "error") {
            this.dispatch({ type: "error" });
          } else {
            this.dispatch({ type: "frame", event });
          }
        },
      },
    )
      .then(() => {
        if (this.controller !== own || this.terminated) {
          return;
        }
        this.dispatch({ type: "close" });
      })
      .catch((err: unknown) => {
        if (this.controller !== own) {
          return;
        }
        // A dead session (401) exits via the logout flow, never backoff.
        if (err instanceof ChatStreamHttpError && err.status === 401) {
          this.dispatch({ type: "http401" });
          return;
        }
        if (this.terminated) {
          return;
        }
        this.dispatch({ type: "close" });
      });
  }

  private clearStall(): void {
    if (this.stallTimer !== undefined) {
      clearTimeout(this.stallTimer);
      this.stallTimer = undefined;
    }
  }

  private clearBackoff(): void {
    if (this.backoffTimer !== undefined) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = undefined;
    }
  }
}

// Bridge a DEAD live-send stream into the reconnect loop. The live send
// (chat.ts) has no reconnect of its own; on screen sleep its stream drops
// silently and nothing wakes the machine. Driven by wake events + a heartbeat,
// this resumes such a turn — but ONLY when it's genuinely stale, so a still-
// healthy live stream is never doubled (the double-delivery guard).
//
// Scope note: the gates below read the GLOBAL active conversation
// (`isStreamingAtom` / `activeConversationAtom`) while `resume` reopens THIS
// controller's mount target. Safe because Collaboration's mount reset keeps the
// active conversation aligned with the mounted (agentInstanceId, conversationId)
// — a view switch remounts this hook and resets the store in the same layout
// pass, so the two never diverge in practice. A turn still in the ↻ window
// (`pending`, no turnId) is intentionally NOT recovered here: reconnect
// reconciles by turnId, which a pending turn hasn't captured yet (see below).
function maybeResume(store: Store, controller: ReconnectController): void {
  // Session dead ⇒ never reconnect. A 401→logout leaves the turn `streaming`,
  // so without this gate every wake (focus/pageshow/visibilitychange/heartbeat)
  // would re-POST an unauthenticated reconnect → 401 → repeat. Stop probing a
  // dead session IN-LAYER rather than relying on the AuthGate unmount to race
  // ahead of the next heartbeat.
  if (!store.get(isAuthenticatedAtom)) {
    return;
  }
  // Nothing streaming ⇒ nothing to recover (a settled/idle chat).
  if (!store.get(isStreamingAtom)) {
    return;
  }
  // Fresh activity ⇒ the live stream is alive and still writing; resuming now
  // would race a from-head replay against its appends. Skip.
  if (Date.now() - store.get(lastActivityAtom) <= STALE_ACTIVITY_MS) {
    return;
  }
  // No turnId yet ⇒ the turn opened but hasn't captured its server id (the
  // pre-first-frame window). The reconnect loop reconciles a resumed turn BY
  // turnId, so handing off now would mint a SECOND ai row and orphan this one
  // stuck `streaming` — the exact freeze this fix targets. Wait for the turnId.
  const conv = store.get(activeConversationAtom);
  const streamingTurn = conv?.history.find(isStreamingAiMessage);
  if (streamingTurn?.turnId === undefined) {
    return;
  }
  // The live stream is presumed dead. Tear it down with the hand-off reason so
  // chat.ts leaves the turn `streaming` (not a user Stop → done), then resume it
  // over the reconnect transport (single-flight-gated).
  //
  // Ownership note: `isStreamingAtom` also matches a `streaming` row that is
  // ALREADY reconnect-owned (minted by createAiRowForTurn) or hydrated from
  // history — neither carries a live-send `sendHandle`. For those the `?.abort`
  // below is a harmless no-op and the `resume` dispatch is absorbed by
  // single-flight (a reconnect stream is already in flight), so re-entering here
  // costs nothing and corrupts nothing.
  //
  // Known narrow limitation: if the user hits Stop in the sub-second window
  // AFTER this dispatch but BEFORE the reconnect stream's first frame sets the
  // machine's `activeTurnId`, `onStop` settles nothing (activeTurnId still
  // undefined) and the row stays `streaming`. Closing it fully would require
  // threading the handed-off turnId through the pure machine's `resume`/`onStop`
  // — a change to the machine contract not worth the regression risk for a race
  // this tight. Any reconnect frame that lands first makes Stop settle correctly.
  conv?.sendHandle?.abort(HANDOFF_ABORT_REASON);
  controller.dispatch({ type: "resume" });
}

// Install every retry trigger for one controller and return a disposer. Only
// `online` is a bare machine trigger (network restored → let the loop retry).
// The live-send→reconnect bridge triggers — `focus`/`pageshow`/`visibilitychange`
// + a heartbeat — all route through `maybeResume`, which runs the staleness +
// turnId + auth gate before handing a dead live-send stream to the loop. Kept
// out of the effect body so the hook's wiring reads as a single install/dispose
// pair.
function installTriggers(
  store: Store,
  controller: ReconnectController,
): () => void {
  const onOnline = (): void => controller.dispatch({ type: "online" });
  // Wake signals a sleeping display/lid MAY fire (none guaranteed — hence the
  // heartbeat as the catch-all). `focus`/`pageshow` cover cases where
  // `visibilitychange` stays silent (desktop screen-off, bfcache restore);
  // `visibilitychange` covers the tab-switch-back that fires none of those. All
  // route through `maybeResume` so the live-send→reconnect hand-off runs the
  // SAME staleness + turnId gate and handle-abort — a bare machine `visible`
  // dispatch would open a reconnect stream without tearing the (maybe-healthy)
  // live-send down, risking double-delivery.
  const onWake = (): void => maybeResume(store, controller);
  const onVisible = (): void => {
    if (document.visibilityState === "visible") {
      maybeResume(store, controller);
    }
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onWake);
  window.addEventListener("pageshow", onWake);
  document.addEventListener("visibilitychange", onVisible);
  // Timer-based catch-all for a drop that fires NO DOM event at all.
  const heartbeat = setInterval(onWake, HEARTBEAT_MS);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("pageshow", onWake);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(heartbeat);
  };
}

// The only React-aware layer: stands up a `ReconnectController` per mount, wires
// the online/visibilitychange/focus/pageshow triggers and the staleness
// heartbeat, fires the entry probe, and tears everything down on unmount via the
// machine's `unmount` commands.
export function useReconnect(
  agentInstanceId: number,
  conversationId?: number,
  options?: UseReconnectOptions,
): { stop: () => void } {
  const store = useStore();
  const { chatEndpoints } = useSicoConfig();
  // Keep the latest reconnect URL + `onReplay` in refs without re-arming the
  // live loop (config is stable in practice, but a change must not tear it
  // down). Written in an effect, not the render body — React 19 concurrent
  // rendering can discard a render pass, leaving a render-time ref write
  // desynced (mirrors use-infinite-scroll-sentinel).
  const { reconnectStreamUrl } = resolveChatEndpoints(chatEndpoints);
  const reconnectUrlRef = useRef(reconnectStreamUrl);
  const onReplayRef = useRef(options?.onReplay);
  const onSettleRef = useRef(options?.onSettle);
  useEffect(() => {
    reconnectUrlRef.current = reconnectStreamUrl;
    onReplayRef.current = options?.onReplay;
    onSettleRef.current = options?.onSettle;
  });

  // `stop` is exposed through a ref so the handle stays stable across renders
  // while the live controller lives inside the effect closure.
  const stopRef = useRef<() => void>(() => {});
  const stop = useCallback(() => stopRef.current(), []);

  useEffect(() => {
    const controller = new ReconnectController(
      store,
      { agentInstanceId, conversationId },
      {
        onReplay: () => onReplayRef.current,
        onSettle: () => onSettleRef.current,
        reconnectUrl: () => reconnectUrlRef.current,
      },
    );

    stopRef.current = () => controller.dispatch({ type: "stop" });
    const disposeTriggers = installTriggers(store, controller);

    // One probe on mount — the entry trigger into the machine. A terminal frame
    // (done/error) settles the loop, so a turn that's already finished (or an
    // empty conversation) probes once and stops rather than spinning.
    controller.dispatch({ type: "probe" });

    return () => {
      disposeTriggers();
      // Terminal teardown: the machine's `unmount` commands abort the in-flight
      // stream and clear every timer.
      controller.dispatch({ type: "unmount" });
      stopRef.current = () => {};
    };
  }, [store, agentInstanceId, conversationId]);

  return { stop };
}
