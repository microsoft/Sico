import {
  type EventSourceMessage,
  fetchEventSource,
} from "@microsoft/fetch-event-source";

import { getAccessToken } from "../../../utils/auth-storage";
import { isSameOriginRequest } from "../../../utils/is-same-origin-request";
import { logger } from "../../../utils/logger";
import { type ChatEvent, chatEventSchema } from "../schemas/chat-event";
import { type ChatRequest } from "../schemas/chat-request";

// Thrown when the response status is not OK. Carries `status` so domain can
// route 401 → the existing `logoutAtom` auth-expiry flow (§6.E matrix) without
// parsing a message body.
export class ChatStreamHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`chat stream failed with status ${status}`);
    this.name = "ChatStreamHttpError";
    this.status = status;
  }
}

export type OpenChatStreamOptions = {
  // Stream URL resolved from `SicoConfig.chatEndpoints` by the calling hook.
  // Injected rather than hardcoded so dwp can point at its own backend without
  // this service knowing the path convention; the bearer token is attached
  // only when this URL resolves same-origin (see below).
  url: string;
  onEvent: (event: ChatEvent) => void;
  // Fires once the response headers arrive (stream open) — drives the `↻→■`
  // button flip in domain. Optional so tests/domain can omit it.
  onOpen?: () => void;
  // Fires on EVERY frame (keepalive included) before any filtering — pure
  // liveness for the recovery staleness watchdog. Keepalive carries no data but
  // IS liveness, so the watchdog must see it before keepalive early-returns.
  // Symmetric with `reconnect-stream.ts`'s `onLive`.
  onLive?: () => void;
  signal: AbortSignal;
};

// Plain async fn (NOT a hook). RESOLVES when the stream closes cleanly OR
// when the caller aborts via `signal` (the lib's abort handler resolves).
// REJECTS on non-2xx (ChatStreamHttpError via onopen) or a mid-stream
// transport failure (§6.E5 — auto-retry off).
export async function openChatStream(
  payload: ChatRequest,
  { url, onEvent, onOpen, onLive, signal }: OpenChatStreamOptions,
): Promise<void> {
  // Read the token per send (never cached at module load), same helper the
  // axios interceptor uses. Missing/expired → no header → backend 401 → the
  // standard onopen(res) 401 path (§6.E9). The URL is now config-injected, so
  // gate the token on a same-origin check (the same one axios uses) — a dwp
  // override pointing off-origin must not leak the bearer to a third party.
  const token = getAccessToken();
  await fetchEventSource(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && isSameOriginRequest(url, undefined)
        ? { Authorization: `Bearer ${token}` }
        : {}),
    },
    body: JSON.stringify(payload),
    signal,
    openWhenHidden: true, // do not pause/retry when the tab is backgrounded
    onopen: async (res) => {
      if (!res.ok) {
        throw new ChatStreamHttpError(res.status);
      }
      onOpen?.();
    },
    onmessage: (msg: EventSourceMessage) => {
      // Liveness FIRST — every frame (keepalive included) proves the stream is
      // alive, BEFORE the keepalive filter below (symmetric with reconnect-stream).
      onLive?.();
      // `keepalive` is filtered BEFORE parse — never a union member (§6.E3).
      if (msg.event === "keepalive") {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(msg.data);
      } catch {
        logger.warn("chat-stream: dropped non-JSON frame", {
          event: msg.event,
        });
        return;
      }
      const parsed = chatEventSchema.safeParse({ event: msg.event, data: raw });
      if (!parsed.success) {
        // Drop the bad frame; do NOT interrupt already-rendered content (§6.E3).
        logger.warn("chat-stream: dropped invalid frame", { event: msg.event });
        return;
      }
      onEvent(parsed.data);
    },
    onerror: (err) => {
      // Rethrow to disable the lib's built-in auto-retry. A non-abort failure
      // then REJECTS the promise; caller-abort is handled separately by the lib
      // (→ resolve), so onerror never receives an AbortError (§6.E5).
      throw err;
    },
  });
}
