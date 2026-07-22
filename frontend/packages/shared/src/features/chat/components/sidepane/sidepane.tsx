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

import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { renderPreviewer } from "./registry";
import { ErrorView } from "../../../../components/error-view";
import { useRetainedContent } from "../../hooks/use-retained-content";
import { useSidepane } from "../../hooks/use-sidepane";
import { useSidepaneA11y } from "../../hooks/use-sidepane-a11y";

// Verbatim §-copy (no i18n layer in this repo — peer sidepane components inline
// their own COPY const the same way). Key: `sidepane.region.label`.
const COPY = {
  regionLabel: "Preview panel",
} as const;

/**
 * The Sidepane shell — base-UI panel with ZERO content-type knowledge (design
 * §6.E1/E2). It reads `content.kind` and hands off to `renderPreviewer`, so a
 * new kind (D2/D3) is one registry row and never a shell edit — that is WHY this
 * dispatches through the registry instead of a `switch`. It imports no
 * individual previewer and no SidepaneHeader (the header lives inside each
 * previewer).
 *
 * Geometry (Figma "Sidepane Container" 17810:83388): an inline right-push card
 * at ~75% of the row when open (1036/1396 ≈ 74%, `w-3/4`), going full-viewport
 * when `maximized` (`fixed inset-0`, covering the chat — MP5). Closed it animates
 * `width` to 0 (matching the Sidebar's `transition-[width]`) rather than
 * unmounting, so the panel slides shut instead of snapping. The previewer is
 * RETAINED through that slide-out by `useRetainedContent` (it renders the
 * lingering `shown`, not the live `content`) and unmounts once the slide ends.
 */
export function Sidepane(): JSX.Element {
  const { content, maximized, close } = useSidepane();
  const shown = useRetainedContent(content);
  const isOpen = content !== null;
  const regionRef = useSidepaneA11y(isOpen, close);

  return (
    // Width-animating shell (matches the Sidebar's `transition-[width]`): open is
    // `w-3/4`, closing animates to `w-0` while `overflow-hidden` clips the
    // retained previewer so it slides shut. Padding lives on the inner float so a
    // closed `w-0` shell leaves no sliver. Maximized escapes to a fixed
    // fullscreen overlay and does NOT animate width. `shrink-0` keeps the basis
    // honest so the chat sibling's flex-1 owns the rest of the row.
    <div
      data-testid="sidepane-shell"
      className={cn(
        "shrink-0",
        maximized
          ? "fixed inset-0 z-50"
          : "duration-medium-1 ease-persistent overflow-hidden transition-[width] motion-reduce:transition-none",
        !maximized && (isOpen ? "w-3/4" : "w-0"),
      )}
    >
      {/* No retained content → render an empty shell (the "Preview panel" region
          is absent until first open and after the slide-out completes). */}
      {shown === null ? null : (
        <div className={cn("flex h-full w-full", !maximized && "pr-4 pb-5")}>
          {/* The scroll container IS the focusable landmark (CE3): screen-reader
              and keyboard users can jump straight to the preview and scroll it. A
              named <section> already exposes role="region", so no explicit role
              is needed. The previewer's sticky header sticks within this overflow
              context. */}
          <section
            ref={regionRef}
            aria-label={COPY.regionLabel}
            // CE3 / axe `scrollable-region-focusable`: a scroll container MUST be
            // keyboard-reachable. jsx-a11y's blanket rule conflicts with that here.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- CE3: the scrollable preview region must be keyboard-focusable
            tabIndex={0}
            data-maximized={maximized}
            className={cn(
              "bg-surface-basic flex h-full w-full flex-col overflow-y-auto",
              !maximized && "border-divider shadow-l rounded-2xl border-l",
            )}
          >
            {/* resetKeys=[shown]: swapping the previewed item clears a prior
                render fault so a new kind starts from a clean boundary (MI17). */}
            <ErrorBoundary FallbackComponent={ErrorView} resetKeys={[shown]}>
              {renderPreviewer(shown)}
            </ErrorBoundary>
          </section>
        </div>
      )}
    </div>
  );
}
