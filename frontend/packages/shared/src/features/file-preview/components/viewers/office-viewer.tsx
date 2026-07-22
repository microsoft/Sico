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

import { type JSX, useEffect, useRef, useState } from "react";

import { logger } from "../../../../utils/logger";
import { LoadingOverlay } from "../loading-overlay";
import { UnpreviewableState } from "../unpreviewable-state";

// Microsoft's hosted Office Online preview. The agent's `fileUrl` is NOT framed
// directly — it's URL-encoded into the `src` query param of THIS fixed Microsoft
// endpoint, which fetches the doc server-side and returns its own rendered page.
const OFFICE_EMBED_BASE = "https://view.officeapps.live.com/op/embed.aspx";

// A frame blocked by CSP / network failure never fires `onLoad`, so without a
// deadline the spinner spins forever. Generous because Office Online can be slow
// on a cold render; a real load almost always resolves well under this.
const OFFICE_LOAD_TIMEOUT_MS = 20_000;

function officeEmbedUrl(fileUrl: string): string {
  return `${OFFICE_EMBED_BASE}?src=${encodeURIComponent(fileUrl)}`;
}

export type OfficeViewerProps = {
  fileUrl: string;
};

/**
 * Office document body (doc/xls/ppt …) — framed through Microsoft's Office
 * Online embed, with a spinner over it until the frame loads. Zero-dependency:
 * Microsoft does the rendering, we only host the iframe.
 *
 * No `sandbox` — DELIBERATELY. The framed origin is a FIXED, trusted Microsoft
 * service (`view.officeapps.live.com`), not the agent's URL — the untrusted
 * `fileUrl` is merely an encoded query param on MS's page, never the frame's own
 * origin. Office Online renders BLANK under any `sandbox` (it needs same-origin
 * cookies/storage + popups its viewer can't get inside a sandbox); verified
 * against the live embed and legacy, both of which frame it un-sandboxed. Agent-
 * authored HTML, by contrast, still goes through the minimal `SandboxedIframe`
 * (`allow-scripts`) — only this trusted Microsoft frame is exempt.
 *
 * Replace-in-place (MP13): the shell swaps `fileUrl` on this same instance, so
 * `loaded`/`errored` reset in render the moment the url changes — otherwise a
 * stale `load` from the previous doc would hide the spinner for the new one
 * (mirrors VideoViewer / SandboxedIframe).
 *
 * Unlike the other viewers the failure signal is a TIMEOUT, not an `error`
 * event: a CSP/network-blocked frame fires neither `load` nor `error`, so a
 * deadline routes the dead frame to the shared download-fallback (MI17) rather
 * than an endless spinner.
 */
export function OfficeViewer({ fileUrl }: OfficeViewerProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prevUrl, setPrevUrl] = useState(fileUrl);
  if (fileUrl !== prevUrl) {
    setPrevUrl(fileUrl);
    setLoaded(false);
    setErrored(false);
  }

  // Arm the load deadline per url; `onLoad` clears it (below). Keyed on
  // `fileUrl` so a replace-in-place swap restarts the clock for the new frame.
  useEffect(() => {
    const timer = setTimeout(() => {
      // A silent timeout would hide a chronic CSP/Office-Online outage; log it
      // so the dead-frame fallback is observable, mirroring the sibling viewers'
      // load-failure logs.
      logger.warn("office preview load timed out", { fileUrl });
      setErrored(true);
    }, OFFICE_LOAD_TIMEOUT_MS);
    timerRef.current = timer;
    return () => clearTimeout(timer);
  }, [fileUrl]);

  const handleLoad = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setLoaded(true);
  };

  if (errored) {
    return <UnpreviewableState />;
  }

  return (
    <div className="relative flex-1">
      {!loaded && <LoadingOverlay />}
      <iframe
        title="Office preview"
        src={officeEmbedUrl(fileUrl)}
        onLoad={handleLoad}
        data-testid="file-office"
        className="size-full border-0"
      />
    </div>
  );
}
