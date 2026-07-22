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
import { type JSX, type ReactNode, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import {
  type LoginMode,
  LoginModeContext,
  type LoginModeValue,
} from "./login-mode-context";
import { OfflineBanner } from "./offline-banner";
import sicoBrandIcon from "../../assets/sico-brand-icon.svg";
import sicoDevWordmark from "../../assets/sico-dev-wordmark.svg";
import sicoWordmark from "../../assets/sico-wordmark.svg";
import { useFocusFirstHeading } from "../../hooks/use-focus-first-heading";
import { InnerErrorFallback } from "../error-boundary/inner-error-fallback";

type LoginLayoutProps = {
  readonly children: ReactNode;
};

/**
 * Login route shell — mirrors `<AppShell>` so 401 / sign-out transitions
 * keep focus parity. `<OfflineBanner>` is a sibling of `<main>` so the
 * live region stays out of the landmark tree. Header is
 * `position: absolute` so `<main>` claims full viewport height and the
 * form centers on the true viewport midline.
 *
 * The brand lockup is three SEPARATE assets composed with flex — a fixed
 * icon + a swappable wordmark — so the icon never changes on a mode switch
 * and each piece stays its own proportion (no cropping a merged SVG). Only
 * the wordmark cross-fades between SICO and SICO.Dev as the mode toggles.
 */
export function LoginLayout({ children }: LoginLayoutProps): JSX.Element {
  const mainRef = useRef<HTMLElement | null>(null);
  useFocusFirstHeading(mainRef);
  const [mode, setMode] = useState<LoginMode>("operator");
  // `useState` returns a fresh tuple each render; memoize so the context value
  // keeps a stable identity and consumers re-render only when `mode` changes.
  const modeValue = useMemo<LoginModeValue>(() => [mode, setMode], [mode]);
  return (
    <LoginModeContext.Provider value={modeValue}>
      <div className="bg-gradient-auth-page relative min-h-screen">
        <OfflineBanner />
        <header className="absolute inset-x-0 top-0 z-10 flex h-20 items-center gap-1 px-10">
          {/* Icon — fixed across modes (shared with the sidebar). h-6 keeps the
              blob the same visual size as legacy beside the h-4 wordmark. */}
          <img src={sicoBrandIcon} alt="" className="h-6 w-auto" />
          {/* Wordmark — two stacked pieces cross-fade on a mode switch; the
              grid overlap lets the box size to the wider (SICO.Dev) one. */}
          <span
            role="img"
            aria-label={mode === "developer" ? "SICO.Dev" : "SICO"}
            className="grid h-4 place-items-start"
          >
            <img
              src={sicoWordmark}
              alt=""
              aria-hidden={mode !== "operator"}
              className={cn(
                "col-start-1 row-start-1 h-4 w-auto transition-opacity duration-200",
                mode === "operator" ? "opacity-100" : "opacity-0",
              )}
            />
            <img
              src={sicoDevWordmark}
              alt=""
              aria-hidden={mode !== "developer"}
              className={cn(
                "col-start-1 row-start-1 h-4 w-auto transition-opacity duration-200",
                mode === "developer" ? "opacity-100" : "opacity-0",
              )}
            />
          </span>
        </header>
        <main
          ref={mainRef}
          className="flex min-h-screen items-center justify-center px-4"
        >
          <ErrorBoundary FallbackComponent={InnerErrorFallback}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </LoginModeContext.Provider>
  );
}
