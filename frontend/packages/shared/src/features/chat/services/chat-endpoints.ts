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
