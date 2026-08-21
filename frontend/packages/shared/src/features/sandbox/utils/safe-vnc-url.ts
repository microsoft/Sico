// Gate a backend-provided VNC url before it goes into the live-view `<iframe>`.
// UNLIKE `safeWebpageUrl` (which gates UNTRUSTED agent-authored urls and so
// demands an absolute `https:`), the VNC url comes from our own authenticated,
// zod-validated `/sandbox/instance` response and is a SAME-ORIGIN RELATIVE path
// — e.g. `/api/dwp/sandbox/resources/.../vnc.html?...`, proxied to the dwp
// backend. `safeWebpageUrl` rejects those (bare `new URL("/x")` throws), which
// is why a live device showed "unavailable".
//
// Contract: resolve against the page origin, then allow ONLY
//   1. a same-origin url (a relative path lands here — the page can only reach
//      its own proxied backend), OR
//   2. an url that is ALREADY an absolute `https:` (the backend occasionally
//      returns a fully qualified one).
// Everything else → null (the caller shows the unavailable state). The
// non-same-origin branch re-parses `cleaned` WITHOUT a base, so a protocol-
// relative `//host` (which `new URL(_, base)` would otherwise promote to the
// page's https scheme and wave through) throws and is blocked — only an input
// that is its own absolute https url survives. This blocks `javascript:`/`data:`
// (neither same-origin nor absolute https), absolute `http://host`, `//host`,
// and the empty string (guarded up front so it can't resolve to the app root).
export function safeVncUrl(raw: string): string | null {
  // Strip wrapping quotes BEFORE trimming so a quoted-whitespace input
  // (`"   "`) collapses to "" and is rejected rather than resolving to root.
  const cleaned = raw.replace(/"/g, "").trim();
  if (cleaned === "") {
    return null;
  }
  let resolved: URL;
  try {
    resolved = new URL(cleaned, window.location.origin);
  } catch {
    // Unparseable even with a base → not a safe src. Deliberate fallback to the
    // blocked path, not a swallowed error.
    return null;
  }
  if (resolved.origin === window.location.origin) {
    return resolved.href;
  }
  // Off-origin: accept only when `cleaned` is itself an absolute https url. A
  // relative path or `//host` can't parse without a base, so this throws → null.
  try {
    const absolute = new URL(cleaned);
    return absolute.protocol === "https:" ? absolute.href : null;
  } catch {
    return null;
  }
}
