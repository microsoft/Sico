import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { openChatStream } from "@/features/chat/services/chat-stream";
import { openReconnectStream } from "@/features/chat/services/reconnect-stream";

import { setupMswServer } from "../../../_helpers/msw-server";

vi.mock("@/utils/auth-storage", () => ({
  getAccessToken: (): string => "test-token",
}));

const server = setupMswServer([]);

function done(): HttpResponse<string> {
  return new HttpResponse('event: done\ndata: {"timestamp":1}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe.each([
  { name: "chat", openStream: openChatStream },
  { name: "reconnect", openStream: openReconnectStream },
])("$name organization headers", ({ name, openStream }) => {
  const url = `/api/sico/conversation/${name}`;

  it("attaches the bound organization alongside Authorization", async () => {
    let observed: Headers | undefined;
    server.use(
      http.post(url, ({ request }) => {
        observed = request.headers;
        return done();
      }),
    );

    await openStream(
      { agentInstanceId: 1, message: "hi", attachments: [] },
      {
        url,
        getOrganizationId: () => 9,
        onEvent: () => {},
        signal: new AbortController().signal,
      },
    );

    expect(observed?.get("X-Sico-Organization-ID")).toBe("9");
    expect(observed?.get("Authorization")).toBe("Bearer test-token");
  });

  it("reads the latest organization on each stream opening", async () => {
    let organizationId: number | null = 9;
    const observed: (string | null)[] = [];
    server.use(
      http.post(url, ({ request }) => {
        observed.push(request.headers.get("X-Sico-Organization-ID"));
        return done();
      }),
    );
    const options = {
      url,
      getOrganizationId: () => organizationId,
      onEvent: () => {},
      signal: new AbortController().signal,
    };
    const payload = { agentInstanceId: 1, message: "hi", attachments: [] };

    await openStream(payload, options);
    organizationId = 10;
    await openStream(payload, options);
    organizationId = null;
    await openStream(payload, options);

    expect(observed).toEqual(["9", "10", null]);
  });

  it("omits organization context for an off-origin stream", async () => {
    const offOrigin = `https://other.example/${name}`;
    const getOrganizationId = vi.fn(() => 9);
    let observed: Headers | undefined;
    server.use(
      http.post(offOrigin, ({ request }) => {
        observed = request.headers;
        return done();
      }),
    );

    await openStream(
      { agentInstanceId: 1, message: "hi", attachments: [] },
      {
        url: offOrigin,
        getOrganizationId,
        onEvent: () => {},
        signal: new AbortController().signal,
      },
    );

    expect(observed?.get("X-Sico-Organization-ID")).toBeNull();
    expect(getOrganizationId).not.toHaveBeenCalled();
  });
});
