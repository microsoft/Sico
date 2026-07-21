// Strip ALL control chars + space globally (not anchored). The WHATWG
// URL parser folds tab / LF / CR / NUL anywhere in a URL before
// navigation, so `"/\t/evil.com"` would otherwise parse as
// `"//evil.com"` (protocol-relative open redirect).
// eslint-disable-next-line no-control-regex -- defensive open-redirect guard
const CONTROL_OR_WS = /[\u0000-\u0020\u007F]/g;

// One forward slash + a non-slash / non-backslash / non-percent char.
// `%` exclusion blocks `/%2fevil.com` percent-encoded bypasses.
const SAME_ORIGIN_PATH = /^\/[^/\\%]/;

export function resolveLandingPath(search: unknown, fallback: string): string {
  if (search === null || typeof search !== "object") {
    return fallback;
  }
  const next = (search as { next?: unknown }).next;
  if (typeof next !== "string" || next.length === 0) {
    return fallback;
  }
  const normalised = next.replace(CONTROL_OR_WS, "");
  if (normalised.length === 0) {
    return fallback;
  }
  if (!SAME_ORIGIN_PATH.test(normalised)) {
    return fallback;
  }
  // Block `/login`, `/login?…`, `/login#…`, `/login/anything` to avoid a
  // self-redirect loop. `/logins` stays safe because the next char must
  // be `/`, `?`, `#`, or end-of-string.
  if (
    normalised === "/login" ||
    normalised.startsWith("/login/") ||
    normalised.startsWith("/login?") ||
    normalised.startsWith("/login#")
  ) {
    return fallback;
  }
  return normalised;
}
