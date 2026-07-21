import { describe, expect, it } from "vitest";

import { resolveChatEndpoints } from "@/features/chat/services/chat-endpoints";

describe("resolveChatEndpoints", () => {
  it("returns sico's own paths when no override is given", () => {
    expect(resolveChatEndpoints()).toEqual({
      messagesPath: "/conversation/messages",
      chatStreamUrl: "/api/sico/conversation/chat",
      reconnectStreamUrl: "/api/sico/conversation/chat/reconnect",
    });
  });

  it("returns sico defaults for an empty override object", () => {
    expect(resolveChatEndpoints({})).toEqual(resolveChatEndpoints());
  });

  it("applies a full dwp override (prefix + v2 paths)", () => {
    expect(
      resolveChatEndpoints({
        apiPrefix: "/api/dwp",
        messagesPath: "/conversation/messages_v2",
        chatPath: "/conversation/chat/v2",
        reconnectPath: "/conversation/chat/v2/reconnect",
      }),
    ).toEqual({
      messagesPath: "/conversation/messages_v2",
      chatStreamUrl: "/api/dwp/conversation/chat/v2",
      reconnectStreamUrl: "/api/dwp/conversation/chat/v2/reconnect",
    });
  });

  it("fills unset fields from defaults on a partial override", () => {
    // Only the prefix changes; paths stay at sico's defaults.
    expect(resolveChatEndpoints({ apiPrefix: "/api/dwp" })).toEqual({
      messagesPath: "/conversation/messages",
      chatStreamUrl: "/api/dwp/conversation/chat",
      reconnectStreamUrl: "/api/dwp/conversation/chat/reconnect",
    });
  });

  it("treats an explicit `undefined` field as unset (no `undefined` in the URL)", () => {
    // A computed override `{ apiPrefix: env.PREFIX }` can be `string | undefined`;
    // an explicit `undefined` must fall back to the default, not concatenate to
    // `"undefined/conversation/chat"`.
    expect(
      resolveChatEndpoints({ apiPrefix: undefined, chatPath: undefined }),
    ).toEqual(resolveChatEndpoints());
  });
});
