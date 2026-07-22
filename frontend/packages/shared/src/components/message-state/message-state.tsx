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

import type * as React from "react";

export type MessageStateProps = {
  /** URL of the decorative illustration (rendered with `alt=""`). */
  illustrationUrl: string;
  /** Intrinsic width of the illustration, in px. */
  illustrationWidth: number;
  /** Intrinsic height of the illustration; also pins the rendered height to avoid layout shift. */
  illustrationHeight: number;
  /** Heading text — rendered as `<h2>`. */
  heading: string;
  /** Body text — short sentence describing the state + optional next step. */
  body: string;
  /** Optional action slot rendered below the body (e.g. retry button). */
  action?: React.ReactNode;
  /**
   * Fill + center within the parent instead of sizing to content. Without it
   * the state pins to the top of its container; with it the state grows to fill
   * the available height and centers — so callers no longer hand-roll a
   * `flex flex-1 items-center justify-center` wrapper around it.
   */
  fill?: boolean;
  /**
   * Optional `data-testid` on the OUTERMOST node — the content root without
   * `fill`, the fill wrapper with it. Lets a caller fold its own test-hook wrapper
   * into this component instead of keeping a `<div data-testid>` around it.
   */
  testId?: string;
  /**
   * Optional ARIA `role` on the OUTERMOST node (same placement as `testId`).
   * Lets an error fallback mount as `<MessageState fill role="alert">` and drop
   * its own centering wrapper, so the fill class lives in exactly one place.
   */
  role?: React.AriaRole;
};

/**
 * Shared message-state primitive — centered illustration + heading +
 * body. Used by empty / error / no-results states across features.
 * Feature wrappers supply illustration + copy; layout & typography
 * pinned here so message surfaces feel consistent.
 */
export function MessageState({
  illustrationUrl,
  illustrationWidth,
  illustrationHeight,
  heading,
  body,
  action,
  fill = false,
  testId,
  role,
}: MessageStateProps): React.JSX.Element {
  const content = (
    <div
      // Outermost node only when NOT filled — then it carries the caller's
      // testId + role.
      data-testid={fill ? undefined : testId}
      role={fill ? undefined : role}
      className="flex w-full flex-col items-center justify-center py-12 text-center"
    >
      <img
        src={illustrationUrl}
        alt=""
        width={illustrationWidth}
        height={illustrationHeight}
        data-testid="message-state-illustration"
      />
      <h2 className="leading-body text-foreground-primary mt-8 text-lg font-medium">
        {heading}
      </h2>
      <p className="leading-body-2 text-foreground-secondary mt-1 max-w-md text-sm">
        {body}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );

  if (!fill) {
    return content;
  }
  // `flex-1 min-h-0` fills a flex parent (cards, scroll areas); `h-full` covers
  // the full-page boundaries whose parent sizes by height — one wrapper serves
  // both the in-card and full-page callers that used to center it themselves.
  return (
    <div
      data-testid={testId}
      role={role}
      className="flex h-full min-h-0 flex-1 items-center justify-center"
    >
      {content}
    </div>
  );
}
