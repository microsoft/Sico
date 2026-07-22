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
