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

import { type ChatEndpointsConfig } from "../../../services/sico-config-context";

// sico's own backend paths. A downstream app (dwp) overrides any of these via
// `SicoConfig.chatEndpoints`; sico stays ignorant of the override's meaning
// (e.g. dwp's "v2" naming) — it only concatenates the strings it's handed.
const DEFAULTS = {
  apiPrefix: "/api/sico",
  messagesPath: "/conversation/messages",
  chatPath: "/conversation/chat",
  reconnectPath: "/conversation/chat/reconnect",
} as const;

export type ChatEndpoints = {
  // axios-relative — inherits the apiClient baseURL.
  readonly messagesPath: string;
  // Same-origin absolute — the raw SSE streams bypass axios.
  readonly chatStreamUrl: string;
  readonly reconnectStreamUrl: string;
};

/**
 * Resolve the chat feature's endpoints from an optional override, filling each
 * unset field with sico's default. A field that is omitted *or* explicitly
 * `undefined` falls back to the default (per-field `??`, not a spread — so a
 * computed override like `{ apiPrefix: env.PREFIX }` can't yield
 * `"undefined/conversation/chat"`). The stream URLs are `apiPrefix + path`;
 * `messagesPath` stays relative (axios prepends the baseURL).
 */
export function resolveChatEndpoints(cfg?: ChatEndpointsConfig): ChatEndpoints {
  const apiPrefix = cfg?.apiPrefix ?? DEFAULTS.apiPrefix;
  const chatPath = cfg?.chatPath ?? DEFAULTS.chatPath;
  const reconnectPath = cfg?.reconnectPath ?? DEFAULTS.reconnectPath;
  return {
    messagesPath: cfg?.messagesPath ?? DEFAULTS.messagesPath,
    chatStreamUrl: `${apiPrefix}${chatPath}`,
    reconnectStreamUrl: `${apiPrefix}${reconnectPath}`,
  };
}
