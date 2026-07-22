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

import { LoadingOverlay } from "./loading-overlay";
import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";
import { safeWebpageUrl } from "../utils/webpage-url";

export type SandboxedIframeProps = {
  // Raw, agent-authored (untrusted) URL — the component gates it itself.
  url: string;
  // Iframe accessible name; also the heading context for the blocked copy.
  title: string;
  // Verbatim message shown when the url is non-https or the frame fails to load.
  blockedCopy: string;
};

/**
 * Shared body that frames an agent-authored URL in a sandboxed `<iframe>` —
 * the iframe half of a previewer, with NO header (the caller mounts that). The
 * webpage previewer and the D3 file `html` subtype both render this, so the
 * security-critical logic lives in exactly one place instead of being
 * copy-pasted (legacy duplicated it across the webpage drawer and FileDrawer).
 *
 * Security boundary (MI4/MI5/OQ5): the URL is untrusted, so `safeWebpageUrl`
 * hard-gates it to `https:` first (a `javascript:`/`data:`/`http:` URL never
 * mounts a frame — it shows the blocked state), and the frame runs with the
 * MINIMAL `sandbox="allow-scripts"`. `allow-same-origin` is deliberately
 * absent: pairing it with `allow-scripts` lets the framed page reach back into
 * its own sandbox and neutralise it, which we must not grant untrusted content.
 * `referrerPolicy="no-referrer"` keeps the app origin out of the `Referer` sent
 * to the untrusted third-party page (matches the `<img>`/`<a>` policy in
 * `markdown-block`).
 *
 * The shell wraps callers in an ErrorBoundary, so React render faults are out of
 * scope — but a runtime load failure is ours, and falls back to the same
 * blocked state (MI17) rather than a dead blank frame.
 */
export function SandboxedIframe({
  url,
  title,
  blockedCopy,
}: SandboxedIframeProps): JSX.Element {
  const safeUrl = safeWebpageUrl(url);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // MP13 (replace-in-place): the shell dispatches by `kind`, so a second
  // deliverable swaps `url` on THIS same instance — no `key` remount. Reset the
  // load state in render the moment the guarded url changes, so the new frame
  // shows its spinner again (MI16) and a stale `errored` from the previous url
  // can't pin the new (valid) one on the blocked state. Render phase, not an
  // effect: in the errored branch the iframe is unmounted, so its ref is null
  // and an effect-based reset would never run.
  const [prevUrl, setPrevUrl] = useState(safeUrl);
  if (safeUrl !== prevUrl) {
    setPrevUrl(safeUrl);
    setLoaded(false);
    setErrored(false);
  }

  // The non-bubbling `error` event needs a NATIVE listener: React 19 delegates
  // iframe `error` to the root container, and a non-bubbling event never reaches
  // it — so a JSX onError on a frame never fires. (`load` is handled by JSX
  // onLoad below — React attaches that one directly to the node during commit,
  // which also avoids the cached-load race an after-paint effect could lose.)
  // Keyed on `safeUrl` so the listener re-binds to the fresh iframe node after a
  // replace-in-place remounts it (an errored→valid swap mounts a NEW node).
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) {
      return undefined;
    }
    const onError = (): void => setErrored(true);
    frame.addEventListener("error", onError);
    return () => {
      frame.removeEventListener("error", onError);
    };
  }, [safeUrl]);

  // Two paths land on the blocked state: a non-https URL that never gets a frame
  // (MI5), and a frame that failed to load (MI17).
  if (safeUrl === null || errored) {
    return (
      <MessageState
        fill
        illustrationUrl={EMPTY_ILLUSTRATIONS.cards.url}
        illustrationWidth={EMPTY_ILLUSTRATIONS.cards.width}
        illustrationHeight={EMPTY_ILLUSTRATIONS.cards.height}
        heading={blockedCopy}
        body=""
      />
    );
  }

  return (
    <div className="relative flex-1">
      {/* Overlay the spinner over the frame until it loads (MI16); the opaque
          surface hides a half-painted frame behind it. */}
      {!loaded && <LoadingOverlay />}
      <iframe
        ref={frameRef}
        title={title}
        src={safeUrl}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className="size-full border-0"
      />
    </div>
  );
}
