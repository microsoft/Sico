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
