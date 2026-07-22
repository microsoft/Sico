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

import { type ChatEndpointsConfig, type SicoConfig } from "@sico/shared";
import { z } from "zod";

// A backend profile is the complete declarative description of one backend:
// where axios points (`baseURL`), where the raw SSE chat streams live
// (`chatEndpoints`), and the per-backend behaviour flags sico exposes. Bundling
// them keeps the set atomic — you can't ship `/api/dwp` while still pointing
// chat at sico's paths.
export type BackendProfile = {
  readonly baseURL: string;
  readonly chatEndpoints: ChatEndpointsConfig;
  readonly sicoFlags: Pick<
    SicoConfig,
    "loginPrefillCredentials" | "digitalWorkerCardShowStatus"
  >;
};

export const PROFILES = {
  sico: {
    baseURL: "/api/sico",
    // Only the prefix differs from sico's defaults; the conversation paths
    // fall through to `resolveChatEndpoints`' own defaults.
    chatEndpoints: { apiPrefix: "/api/sico" },
    sicoFlags: {
      loginPrefillCredentials: true,
      digitalWorkerCardShowStatus: false,
    },
  },
  dwp: {
    baseURL: "/api/dwp",
    // dwp's conversation backend uses a `/api/dwp` prefix and `*_v2` / `/v2`
    // path suffixes. sico stays unaware — it just concatenates these strings.
    chatEndpoints: {
      apiPrefix: "/api/dwp",
      messagesPath: "/conversation/messages_v2",
      chatPath: "/conversation/chat/v2",
      reconnectPath: "/conversation/chat/v2/reconnect",
    },
    sicoFlags: {
      loginPrefillCredentials: false,
      digitalWorkerCardShowStatus: true,
    },
  },
} as const satisfies Record<string, BackendProfile>;

export type BackendKey = keyof typeof PROFILES;

// Derived from PROFILES, so a new profile is reachable with no second edit.
function isBackendKey(raw: string): raw is BackendKey {
  return Object.hasOwn(PROFILES, raw);
}

/**
 * Resolve the build-time `VITE_BACKEND` value to a profile key. An absent or
 * empty value defaults to `sico` (so existing sico builds need no env). A
 * present-but-unknown value throws at startup rather than silently booting
 * against the wrong backend.
 */
export function resolveBackendKey(raw: string | undefined): BackendKey {
  if (raw === undefined || raw === "") {
    return "sico";
  }
  if (!isBackendKey(raw)) {
    throw new Error(
      `VITE_BACKEND="${raw}" is not a known backend (expected: ${Object.keys(PROFILES).join(" | ")})`,
    );
  }
  return raw;
}

// `import.meta.env.VITE_BACKEND` is `any` (vite's env has no per-key typing);
// zod parses it to a validated `string | undefined` at the boundary before the
// key check sees it.
const rawBackend = z
  .string()
  .optional()
  .parse(import.meta.env.VITE_BACKEND);

export const backendProfile: BackendProfile =
  PROFILES[resolveBackendKey(rawBackend)];
