// Render-time guard for `iconUri` values that flow into `<img src>`.
// Backend may send "", a relative path, or an absolute http(s) URL.
// Anything else (`data:`, `javascript:`, file://, blob:, etc.) is
// suppressed so a poisoned response can't smuggle tracking pixels or
// `data:` payloads through the avatar slot. Returns `undefined` to
// signal "fall back to initials / default icon".
//
// ALSO gates an `<a href>` (the asset-detail source-file chip) AND
// `window.open()` (the deliverable / open-link new-tab navigation). Keep the
// allowlist http(s)/same-origin only — do NOT permit `data:` here: it is
// inert in `<img src>` but XSS-capable in `<a href>` and `window.open`, so
// relaxing it for avatars would silently weaken those navigation consumers.
//
// Path-relative URLs are passed through (icons are served by our
// backend proxy under same-origin paths) but only if they have NO
// query string or fragment. Without that, a hostile payload like
// `/api/admin/whatever?confirm=1` would be GETed by the browser with
// cookies — turning the avatar slot into a same-origin SSRF surface
// against any GET endpoint that has side effects.
export function safeIconUri(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  // Relative path — same-origin, served by our app or backend proxy.
  // Reject `?` / `#` to deny side-effect GETs and fragment payloads.
  // Reject protocol-relative (`//host`) and backslash-smuggled
  // (`/\host`) forms — browsers resolve those against the page's
  // origin host, not the path, defeating same-origin intent.
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.startsWith("/\\")) {
      return undefined;
    }
    if (value.includes("?") || value.includes("#")) {
      return undefined;
    }
    return value;
  }
  // Absolute URL — only http/https, and no embedded userinfo
  // (`https://user:pass@host/x` leaks credentials in referrers).
  try {
    const url = new URL(value);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    ) {
      return value;
    }
  } catch {
    // Fall through.
  }
  return undefined;
}
