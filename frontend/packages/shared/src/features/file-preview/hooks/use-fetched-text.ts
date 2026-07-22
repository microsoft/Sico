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

import { useEffect, useState } from "react";

import { logger } from "../../../utils/logger";

export type FetchedText = {
  content: string;
  loading: boolean;
  error: boolean;
};

/**
 * Fetch a file URL's text body for the `.txt` / `.md` subtype viewers, which
 * share this exact state machine (only their rendered body differs).
 *
 * Replace-in-place (MP13): the shell swaps `fileUrl` on the same viewer
 * instance, so `loading`/`error` reset in render the moment the url changes —
 * otherwise a stale load/error from the previous file would carry into the new
 * one. `content` is intentionally NOT reset: the caller's spinner overlay masks
 * it while the new load is pending, avoiding a flash of empty content.
 *
 * The fetch is keyed on `fileUrl` and aborts on unmount / url-change so a
 * settled response can't update a torn-down (or superseded) component. `fetch`
 * only rejects on a network failure — a 403 (expired SAS) or 404 still
 * resolves, so the `response.ok` check routes an error body to the failure
 * state instead of rendering it as the file's text.
 */
export function useFetchedText(fileUrl: string): FetchedText {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(fileUrl);
  if (fileUrl !== prevUrl) {
    setPrevUrl(fileUrl);
    setLoading(true);
    setError(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(fileUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`file text fetch failed: ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        if (!controller.signal.aborted) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        // An aborted fetch (url swap / unmount) rejects by design — only a real
        // failure surfaces as the download-fallback state.
        if (controller.signal.aborted) {
          return;
        }
        logger.error("file text load failed", { fileUrl, error: cause });
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [fileUrl]);

  return { content, loading, error };
}
