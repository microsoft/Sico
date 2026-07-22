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

import type { JSX, ReactNode } from "react";

import { MessageState } from "../../../components/message-state";
import {
  UNPREVIEWABLE_COPY,
  UNPREVIEWABLE_ILLUSTRATION,
} from "../utils/unpreviewable-copy";

export type UnpreviewableStateProps = {
  /** Optional call-to-action under the copy — e.g. the UnsupportedViewer's
   *  Download button. Omitted by the inline error fallbacks. */
  action?: ReactNode;
};

/**
 * The shared "this file can't be previewed" body — the no-preview illustration
 * plus the download-it copy. Every viewer that hits a non-renderable / load-
 * failed state renders this so the fallback can't drift across call sites (the
 * copy + illustration already live in `unpreviewable-copy.ts`; this fixes the
 * `MessageState` wiring in one place too).
 *
 * Owns its own fill+center wrapper (via `MessageState fill`) so the state
 * fills the previewer body and centers — `MessageState` only sizes to its
 * content, so a bare render would sit flush under the header. Callers mount it
 * directly (no per-viewer wrapper); the glb/pdf error overlays add only
 * positioning + an opaque surface on top of this.
 */
export function UnpreviewableState({
  action,
}: UnpreviewableStateProps): JSX.Element {
  return (
    <MessageState
      fill
      testId="unpreviewable-state"
      illustrationUrl={UNPREVIEWABLE_ILLUSTRATION.url}
      illustrationWidth={UNPREVIEWABLE_ILLUSTRATION.width}
      illustrationHeight={UNPREVIEWABLE_ILLUSTRATION.height}
      heading={UNPREVIEWABLE_COPY.heading}
      body={UNPREVIEWABLE_COPY.body}
      action={action}
    />
  );
}
