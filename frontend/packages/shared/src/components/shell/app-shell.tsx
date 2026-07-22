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

import { type JSX, type ReactNode, useRef } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { OfflineBanner } from "./offline-banner";
import { Sidebar } from "../../features/sidebar/components/sidebar";
import type { NavItemData } from "../../features/sidebar/types";
import { useFocusFirstHeading } from "../../hooks/use-focus-first-heading";
import { InnerErrorFallback } from "../error-boundary/inner-error-fallback";

type AppShellProps = {
  readonly children: ReactNode;
  // Data-driven nav entries injected after the built-in items (Digital
  // Workers, Projects). Default `undefined` — sico renders no extras; a
  // downstream app (dwp) passes e.g. a My Team entry. sico renders each in
  // both the expanded sidebar and the collapsed rail with its own chrome.
  readonly extraNavItems?: readonly NavItemData[];
  // Header-area slot (sidebar top bar when expanded, rail top when collapsed).
  // Default `undefined` — sico shows nothing; dwp injects e.g. the notification
  // bell. Kept app-agnostic: the slot is a `ReactNode`, the behaviour lives in
  // the injected component.
  readonly headerExtras?: ReactNode;
  // Free-form slot at the TOP of the menu list (above Digital Workers), the
  // counterpart to `extraNavItems`'s bottom append. Default `undefined`; dwp
  // injects the Notification row. Compose from `NavRow`/`RailNavRow`.
  readonly menuTopExtras?: ReactNode;
};

/**
 * Authenticated route shell. Composes into `routes/_authed.tsx`.
 *
 * Does NOT render its own `<h1>`: if it did, `useFocusFirstHeading`
 * would always focus *that* on route change and page headings would
 * never receive focus. Contract: one `<h1>` per route, owned by the
 * page, with `tabIndex={-1}`.
 */
export function AppShell({
  children,
  extraNavItems,
  headerExtras,
  menuTopExtras,
}: AppShellProps): JSX.Element {
  const mainRef = useRef<HTMLElement | null>(null);
  useFocusFirstHeading(mainRef);
  return (
    <div className="flex h-screen">
      <Sidebar
        extraNavItems={extraNavItems}
        headerExtras={headerExtras}
        menuTopExtras={menuTopExtras}
      />
      {/* Content column sits above the sidebar (z-10) and casts a leftward
          shadow onto it via `--shadow-seam` — two soft, low-opacity layers
          (0.04 / 0.03) so the seam reads as a gentle cast shadow, not a
          hairline. */}
      <div className="border-stroke-seam shadow-seam relative z-10 flex min-w-0 flex-1 flex-col border-l">
        <OfflineBanner />
        <main ref={mainRef} className="relative flex-1 overflow-hidden">
          {/* Decorative ambient background — two blurred color-wash blobs +
              a paper-grain overlay, as three sibling layers so the washes blend
              with each other and the grain multiplies over both (matches the
              original component). Light-only (`dark:hidden`): in dark mode the
              wrapper collapses so the canvas' own dark surface shows through.
              Content lives in the `relative z-10` sibling below, so the washes
              always sit behind it. The blob + grain values Tailwind can't
              express live in the `bg-app-glow-warm` / `bg-app-glow-cool` /
              `bg-app-grain` utilities. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden dark:hidden"
          >
            <div className="bg-app-glow-warm absolute rounded-full opacity-80" />
            <div className="bg-app-glow-cool absolute rounded-full opacity-60" />
            <div className="bg-app-grain absolute inset-0 opacity-40 mix-blend-multiply" />
          </div>
          <div className="relative z-10 h-full">
            <ErrorBoundary FallbackComponent={InnerErrorFallback}>
              {children}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
