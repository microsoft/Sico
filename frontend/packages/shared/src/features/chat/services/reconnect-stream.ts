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

// Deliberate near-clone of `chat-stream.ts` — they now differ only in payload
// shape (this one sends a reconnect target, not a chat message). The `onLive`
// liveness hook, the `onopen` 401 throw, the parse → safeParse → drop-with-warn
// pipeline, and the `onerror` rethrow are duplicated on purpose (two transports
// = YAGNI). Keep them in sync with the sibling file when either changes.
import {
  type EventSourceMessage,
  fetchEventSource,
} from "@microsoft/fetch-event-source";

import { ChatStreamHttpError } from "./chat-stream";
import { getAccessToken } from "../../../utils/auth-storage";
import { isSameOriginRequest } from "../../../utils/is-same-origin-request";
import { logger } from "../../../utils/logger";
import { type ChatEvent, chatEventSchema } from "../schemas/chat-event";

// Re-export the SHARED error type: the domain's 401 branch `instanceof`-matches
// a single class across both transports.
export { ChatStreamHttpError };

// Reconnect sends the agent instance plus (for dwp multi-conversation) the
// target `conversationId` — no message/attachments — so it does NOT reuse
// `ChatRequest`. The backend resumes the in-flight turn from (username, agentId,
// agentInstanceId[, conversationId]). `conversationId` is omitted for sico (v1).
export type ReconnectStreamPayload = {
  agentInstanceId: number;
  conversationId?: number;
};

export type OpenReconnectStreamOptions = {
  // Reconnect URL resolved from `SicoConfig.chatEndpoints` by the calling hook.
  // Injected rather than hardcoded — see chat-stream.ts; the bearer token is
  // attached only when this URL resolves same-origin.
  url: string;
  onEvent: (event: ChatEvent) => void;
  // Fires once the stream opens — drives the `↻→■` button flip.
  onOpen?: () => void;
  // Fires on EVERY frame (keepalive included) before any filtering — pure
  // liveness for the stall-watchdog. Keepalive carries no data but IS liveness,
  // so the watchdog must see it before keepalive early-returns.
  onLive?: () => void;
  signal: AbortSignal;
};

// Plain async fn (NOT a hook). RESOLVES when the stream closes cleanly OR when
// the caller aborts via `signal`. REJECTS on non-2xx (ChatStreamHttpError via
// onopen) or a mid-stream transport failure (auto-retry off).
export async function openReconnectStream(
  payload: ReconnectStreamPayload,
  { url, onEvent, onOpen, onLive, signal }: OpenReconnectStreamOptions,
): Promise<void> {
  // Read the token per send (never cached), same helper the axios interceptor
  // uses. Missing/expired → no header → backend 401 → standard onopen 401 path.
  // The URL is config-injected, so gate the token on a same-origin check — see
  // chat-stream.ts.
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
      // alive, BEFORE the keepalive filter below.
      onLive?.();
      // `keepalive` is filtered BEFORE parse — never a union member.
      if (msg.event === "keepalive") {
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(msg.data);
      } catch {
        logger.warn("reconnect-stream: dropped non-JSON frame", {
          event: msg.event,
        });
        return;
      }
      const parsed = chatEventSchema.safeParse({ event: msg.event, data: raw });
      if (!parsed.success) {
        // Drop the bad frame; do NOT interrupt already-rendered content.
        logger.warn("reconnect-stream: dropped invalid frame", {
          event: msg.event,
        });
        return;
      }
      onEvent(parsed.data);
    },
    onerror: (err) => {
      // Rethrow to disable the lib's built-in auto-retry. A non-abort failure
      // then REJECTS; caller-abort is handled separately by the lib, so onerror
      // never receives an AbortError.
      throw err;
    },
  });
}
