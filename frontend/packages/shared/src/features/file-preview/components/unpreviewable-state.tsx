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
