// Same-origin gate so absolute URLs to third-party hosts cannot receive our
// bearer token. Resolves `requestUrl` against `baseUrl` first so
// `api.get("/me")` against `baseURL: "https://api.example.com"` is evaluated
// absolute. Relative request URLs (no host) resolve to the document origin, so
// they pass. Malformed inputs and non-browser (SSR) contexts default to
// `false` — a conservative "no header" stance.
//
// Consumed by both the axios request interceptor and the raw `fetchEventSource`
// SSE streams (chat + reconnect), which bypass axios but carry the same token.
export function isSameOriginRequest(
  requestUrl: string | undefined,
  baseUrl: string | undefined,
): boolean {
  if (!requestUrl) {
    return false;
  }
  const hasOrigin = typeof window !== "undefined" && Boolean(window.location);
  const documentOrigin = hasOrigin ? window.location.origin : null;

  try {
    const originFallback = documentOrigin ?? "http://localhost";
    const absoluteBase = baseUrl
      ? new URL(baseUrl, originFallback).toString()
      : originFallback;
    const resolved = new URL(requestUrl, absoluteBase);
    if (documentOrigin === null) {
      // SSR / Node-only context — conservative "no header" stance.
      return false;
    }
    return resolved.origin === documentOrigin;
  } catch {
    return false;
  }
}
