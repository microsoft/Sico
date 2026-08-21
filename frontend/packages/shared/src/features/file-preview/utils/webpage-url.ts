// Gate an agent-authored URL before it goes into an `<iframe src>`. Agent
// content is untrusted, so we hard-allow ONLY `https:` — `javascript:` / `data:`
// are XSS/exfiltration vectors and plain `http:` is mixed-content. Anything else
// → null, and the caller shows a "blocked" state instead of mounting the iframe.
// (Migration MI5 / OQ5: tighter than legacy, which only quote-stripped the URL.)
export function safeWebpageUrl(raw: string): string | null {
  // Legacy agent URLs arrive wrapped in double-quotes and with stray
  // whitespace; clean both before parsing (mirrors legacy `replace(/"/g, "")`).
  const cleaned = raw.trim().replace(/"/g, "");

  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    // Malformed input can't be a safe iframe src — deliberate fallback to null
    // (the "blocked" path), not a swallowed error. `new URL` throws on garbage.
    return null;
  }
}
