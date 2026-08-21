import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useMemo,
} from "react";

import type { Agent } from "../features/digital-worker/schemas/agent";

/**
 * App-level feature configuration for sico shared features. Each flag's
 * DEFAULT is sico's own behaviour; a downstream app (e.g. dwp) overrides
 * only what it needs via `<SicoConfigProvider config={...}>`.
 *
 * Unlike `ApiClientProvider`, NOT wrapping is valid: `useSicoConfig`
 * returns `DEFAULT_SICO_CONFIG` so sico keeps working unconfigured.
 *
 * Flags are flat — prefix the name with the feature it belongs to (e.g.
 * `loginPrefillCredentials`) rather than nesting, so a one-flag feature
 * doesn't pay for a namespace object.
 */
// Backend endpoint overrides for the chat feature. sico talks to its OWN
// backend (`/api/sico` + the default conversation paths); a downstream app
// (dwp) points at a different backend with different paths. Each field is an
// opaque string the app supplies verbatim — sico never parses or interprets
// it (it has no concept of dwp's "v2" convention). All optional; an omitted
// field falls back to sico's own default in `resolveChatEndpoints`.
export type ChatEndpointsConfig = {
  // Same-origin prefix for the raw SSE streams (NOT the axios baseURL).
  // Default "/api/sico"; dwp passes "/api/dwp".
  readonly apiPrefix?: string;
  // axios-relative history path. Default "/conversation/messages".
  readonly messagesPath?: string;
  // Stream path appended to `apiPrefix`. Default "/conversation/chat".
  readonly chatPath?: string;
  // Reconnect stream path appended to `apiPrefix`.
  // Default "/conversation/chat/reconnect".
  readonly reconnectPath?: string;
};

export type SicoConfig = {
  // Seed the login form with the local-dev operator account. sico keeps it
  // on for convenience; dwp turns it off (enterprise SSO accounts).
  readonly loginPrefillCredentials: boolean;
  // Show the DW card status indicator (Active/Onboarding/…) + the NEW dot.
  // sico omits it by default; dwp turns it on.
  readonly digitalWorkerCardShowStatus: boolean;
  // Handle a DW card click imperatively instead of linking to collaboration.
  // Default `undefined` → sico keeps the plain `<Link>`. dwp supplies a handler
  // that branches on the agent's lifecycle status (write status / route to
  // evaluation or performance / open the onboarding wizard) — all that logic +
  // the wizard live in dwp; sico only knows this callback's shape, never
  // importing dwp/legacy code. May be async (await a status write before
  // navigating); the card disables itself while it's pending.
  readonly onDigitalWorkerCardClick?: (agent: Agent) => void | Promise<void>;
  // Override the chat backend endpoints. Default `undefined` → sico's own
  // backend paths; dwp supplies its `/api/dwp` + `*_v2` paths.
  readonly chatEndpoints?: ChatEndpointsConfig;
};

export const DEFAULT_SICO_CONFIG: SicoConfig = {
  loginPrefillCredentials: true,
  digitalWorkerCardShowStatus: false,
};

const SicoConfigContext = createContext<SicoConfig>(DEFAULT_SICO_CONFIG);

export function SicoConfigProvider({
  config,
  children,
}: {
  readonly config?: Partial<SicoConfig>;
  readonly children: ReactNode;
}): JSX.Element {
  const value = useMemo(
    () => ({ ...DEFAULT_SICO_CONFIG, ...config }),
    [config],
  );
  return (
    <SicoConfigContext.Provider value={value}>
      {children}
    </SicoConfigContext.Provider>
  );
}

export function useSicoConfig(): SicoConfig {
  return useContext(SicoConfigContext);
}
