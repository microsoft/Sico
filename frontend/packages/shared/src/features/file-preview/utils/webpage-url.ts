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
