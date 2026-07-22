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

import { Button } from "@sico/ui";
import { ArrowRight, Square } from "lucide-react";
import { type JSX } from "react";

import { SpinnerButton } from "./spinner-button";
import { noop } from "../../../utils/noop";

type Props = {
  isStreaming: boolean;
  isRequestPending: boolean;
  // A caller-owned async pre-step (the DW home's create-conversation) is in
  // flight. Shows the same spinner as `isRequestPending` but is NOT stoppable
  // (create can't be cancelled) — the click is a no-op and the label differs.
  submitting: boolean;
  showSend: boolean;
  disabled: boolean;
  onSend: () => void;
  onStop: () => void;
};

// Send-area glyph: ■ stop while streaming → ↻ loading after click → → send when
// text is present, else absent. `submitting` (create in flight) shows the same
// ↻ spinner but non-stoppable.
export function ComposerSendButton({
  isStreaming,
  isRequestPending,
  submitting,
  showSend,
  disabled,
  onSend,
  onStop,
}: Props): JSX.Element | null {
  if (submitting) {
    // Create in flight — non-stoppable, so the click is a no-op.
    return <SpinnerButton label="Sending…" onClick={noop} />;
  }
  if (isStreaming) {
    return (
      <Button
        type="button"
        size="icon"
        variant="subtle"
        className="rounded-full bg-neutral-200"
        aria-label="Stop response"
        onClick={onStop}
      >
        {/* A dark FILLED square on a light circle — fill-current paints it solid. */}
        <Square className="text-foreground-primary fill-current" />
      </Button>
    );
  }
  if (isRequestPending) {
    // The ↻ window — the same spinner, but clicking it stops the request.
    return <SpinnerButton label="Stop request" onClick={onStop} />;
  }
  if (showSend) {
    return (
      <Button
        type="button"
        size="icon"
        className="rounded-full"
        aria-label="Send message"
        disabled={disabled}
        onClick={onSend}
      >
        <ArrowRight />
      </Button>
    );
  }
  return null;
}
