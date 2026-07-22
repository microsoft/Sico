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

import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { type ChatEvent } from "@/features/chat/schemas/chat-event";
import {
  ChatStreamHttpError,
  openReconnectStream,
} from "@/features/chat/services/reconnect-stream";

import { setupMswServer } from "../../../_helpers/msw-server";

vi.mock("@/utils/auth-storage", () => ({
  getAccessToken: (): string => "test-token",
}));

const RECONNECT_URL = "/api/sico/conversation/chat/reconnect";

function sse(...lines: string[]): HttpResponse<string> {
  const body = lines.join("");
  return new HttpResponse(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const server = setupMswServer([]);

const PAYLOAD = { agentInstanceId: 1 };

describe("openReconnectStream", () => {
  it("emits message then done as validated ChatEvents", async () => {
    server.use(
      http.post(RECONNECT_URL, () =>
        sse(
          frame("message", { type: 1, content: "hel" }),
          frame("message", { type: 1, content: "lo" }),
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    const events: ChatEvent[] = [];
    await openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(events.map((e) => e.event)).toEqual(["message", "message", "done"]);
  });

  it("throws ChatStreamHttpError on a non-2xx response (so domain can branch on 401)", async () => {
    server.use(
      http.post(RECONNECT_URL, () => new HttpResponse(null, { status: 401 })),
    );
    const run = openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    // The error TYPE is load-bearing: the shared 401 branch `instanceof`-matches
    // the SAME class the chat transport throws.
    await expect(run).rejects.toBeInstanceOf(ChatStreamHttpError);
    await expect(run).rejects.toMatchObject({ status: 401 });
  });

  it("fires onLive for a keepalive frame but never reaches onEvent", async () => {
    // keepalive carries no data — it is pure liveness for the watchdog.
    server.use(
      http.post(RECONNECT_URL, () =>
        sse("event: keepalive\ndata: \n\n", frame("done", { timestamp: 1 })),
      ),
    );
    const onLive = vi.fn();
    const events: ChatEvent[] = [];
    await openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: (e) => events.push(e),
      onLive,
      signal: new AbortController().signal,
    });
    // onLive fires on EVERY onmessage (keepalive + done = 2)...
    expect(onLive).toHaveBeenCalledTimes(2);
    // ...but the keepalive never reaches onEvent — only the data frame does.
    expect(events.map((e) => e.event)).toEqual(["done"]);
  });

  it("fires onLive on a data frame too, before onEvent", async () => {
    const order: string[] = [];
    server.use(
      http.post(RECONNECT_URL, () =>
        sse(
          frame("message", { type: 1, content: "hi" }),
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    await openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: (e) => order.push(`event:${e.event}`),
      onLive: () => order.push("live"),
      signal: new AbortController().signal,
    });
    // Two onmessage frames → onLive twice, each strictly before its onEvent.
    expect(order).toEqual(["live", "event:message", "live", "event:done"]);
  });

  it("fires onLive for a malformed frame but drops it from onEvent", async () => {
    // A garbage frame is still BYTES on the wire → liveness; but it must never
    // reach onEvent. This pins onLive firing BEFORE the JSON.parse try/catch.
    server.use(
      http.post(RECONNECT_URL, () =>
        sse(
          frame("message", { type: 1, content: "ok" }),
          "event: message\ndata: {not json}\n\n",
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    const onLive = vi.fn();
    const events: ChatEvent[] = [];
    await openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: (e) => events.push(e),
      onLive,
      signal: new AbortController().signal,
    });
    // onLive fires for all three onmessage frames (good + malformed + done)...
    expect(onLive).toHaveBeenCalledTimes(3);
    // ...but the malformed frame is dropped — only the two valid ones dispatch.
    expect(events.map((e) => e.event)).toEqual(["message", "done"]);
  });

  it("calls onOpen once when the stream opens", async () => {
    server.use(
      http.post(RECONNECT_URL, () => sse(frame("done", { timestamp: 1 }))),
    );
    const onOpen = vi.fn();
    await openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: () => {},
      onOpen,
      signal: new AbortController().signal,
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("attaches the bearer token from getAccessToken", async () => {
    let auth: string | null = null;
    server.use(
      http.post(RECONNECT_URL, ({ request }) => {
        auth = request.headers.get("authorization");
        return sse(frame("done", { timestamp: 1 }));
      }),
    );
    await openReconnectStream(PAYLOAD, {
      url: RECONNECT_URL,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(auth).toBe("Bearer test-token");
  });

  it("does NOT attach the bearer token to an off-origin stream URL", async () => {
    // A dwp override pointing at a third-party host must not leak the token.
    // jsdom's origin is http://localhost:3000, so this absolute URL is cross-origin.
    const offOrigin = "https://evil.example.com/conversation/chat/reconnect";
    let auth: string | null = null;
    server.use(
      http.post(offOrigin, ({ request }) => {
        auth = request.headers.get("authorization");
        return sse(frame("done", { timestamp: 1 }));
      }),
    );
    await openReconnectStream(PAYLOAD, {
      url: offOrigin,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(auth).toBeNull();
  });
});
