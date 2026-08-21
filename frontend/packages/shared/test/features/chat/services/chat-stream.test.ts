import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { type ChatEvent } from "@/features/chat/schemas/chat-event";
import { openChatStream } from "@/features/chat/services/chat-stream";

import { setupMswServer } from "../../../_helpers/msw-server";

vi.mock("@/utils/auth-storage", () => ({
  getAccessToken: (): string => "test-token",
}));

const CHAT_URL = "/api/sico/conversation/chat";

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

const PAYLOAD = { agentInstanceId: 1, message: "hi", attachments: [] };

describe("openChatStream", () => {
  it("emits message then done as validated ChatEvents", async () => {
    server.use(
      http.post(CHAT_URL, () =>
        sse(
          frame("message", { type: 1, content: "hel" }),
          frame("message", { type: 1, content: "lo" }),
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    const events: ChatEvent[] = [];
    await openChatStream(PAYLOAD, {
      url: CHAT_URL,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(events.map((e) => e.event)).toEqual(["message", "message", "done"]);
  });

  it("attaches the bearer token from getAccessToken", async () => {
    let auth: string | null = null;
    server.use(
      http.post(CHAT_URL, ({ request }) => {
        auth = request.headers.get("authorization");
        return sse(frame("done", { timestamp: 1 }));
      }),
    );
    await openChatStream(PAYLOAD, {
      url: CHAT_URL,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(auth).toBe("Bearer test-token");
  });

  it("does NOT attach the bearer token to an off-origin stream URL", async () => {
    // A dwp override pointing at a third-party host must not leak the token.
    // jsdom's origin is http://localhost:3000, so this absolute URL is cross-origin.
    const offOrigin = "https://evil.example.com/conversation/chat";
    let auth: string | null = null;
    server.use(
      http.post(offOrigin, ({ request }) => {
        auth = request.headers.get("authorization");
        return sse(frame("done", { timestamp: 1 }));
      }),
    );
    await openChatStream(PAYLOAD, {
      url: offOrigin,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(auth).toBeNull();
  });

  it("drops a malformed frame but keeps the good ones", async () => {
    server.use(
      http.post(CHAT_URL, () =>
        sse(
          frame("message", { type: 1, content: "ok" }),
          "event: message\ndata: {not json}\n\n",
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    const events: ChatEvent[] = [];
    await openChatStream(PAYLOAD, {
      url: CHAT_URL,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(events.map((e) => e.event)).toEqual(["message", "done"]);
  });

  it("throws on a non-2xx response (so domain can branch on 401)", async () => {
    server.use(
      http.post(CHAT_URL, () => new HttpResponse(null, { status: 401 })),
    );
    await expect(
      openChatStream(PAYLOAD, {
        url: CHAT_URL,
        onEvent: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("resolves (does not reject) when the caller aborts mid-stream", async () => {
    server.use(
      http.post(CHAT_URL, () =>
        sse(
          frame("message", { type: 1, content: "hi" }),
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    const controller = new AbortController();
    await expect(
      openChatStream(PAYLOAD, {
        url: CHAT_URL,
        onEvent: () => controller.abort(),
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
  });

  it("calls onOpen once when the stream opens", async () => {
    server.use(http.post(CHAT_URL, () => sse(frame("done", { timestamp: 1 }))));
    const onOpen = vi.fn();
    await openChatStream(PAYLOAD, {
      url: CHAT_URL,
      onEvent: () => {},
      onOpen,
      signal: new AbortController().signal,
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("calls onLive on every frame including keepalive, but onEvent only on content", async () => {
    // `onLive` is pure liveness for the recovery staleness watchdog — it must
    // fire on keepalives too (which never reach onEvent), so a quiet-but-alive
    // stream keeps the activity clock fresh and is not falsely reconnected.
    server.use(
      http.post(CHAT_URL, () =>
        sse(
          frame("keepalive", {}),
          frame("message", { type: 1, content: "hi" }),
          frame("done", { timestamp: 1 }),
        ),
      ),
    );
    const onLive = vi.fn();
    const events: ChatEvent[] = [];
    await openChatStream(PAYLOAD, {
      url: CHAT_URL,
      onEvent: (e) => events.push(e),
      onLive,
      signal: new AbortController().signal,
    });
    // Fires for keepalive + message + done (every frame, before any filtering).
    expect(onLive).toHaveBeenCalledTimes(3);
    // onEvent still only sees the two content frames — keepalive is filtered.
    expect(events.map((e) => e.event)).toEqual(["message", "done"]);
  });
});
