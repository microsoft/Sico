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
      <h2 className="text-foreground-primary leading-body mt-8 text-lg font-medium">
        {heading}
      </h2>
      <p className="text-foreground-secondary leading-body-2 mt-1 max-w-md text-sm">
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
