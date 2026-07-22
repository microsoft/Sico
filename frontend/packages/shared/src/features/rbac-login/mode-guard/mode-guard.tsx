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

import { useMatches, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect } from "react";

import { userModeAtom } from "../../../atoms/user-mode-atom";
import type { LoginMode } from "../../../components/shell/login-mode-context";
import { resolveModeRedirect } from "../../../utils/resolve-mode-redirect";

declare module "@tanstack/react-router" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- TanStack Router's public API uses `interface` for module-augmentation merging
  interface StaticDataRouteOption {
    // Login modes allowed to reach this route. Omit for shared routes
    // (accessible in every mode). Read by `<ModeGuard>` to pick the landing
    // face; the sidebar hand-maintains a matching branch (it does not read this
    // field). UI filter only — NOT an access-control boundary. A user can flip
    // the persisted mode in devtools; real authorization is server-enforced.
    modes?: readonly LoginMode[];
  }
}

/**
 * Runtime mode guard. Pairs with the token `beforeLoad` in the consuming app's
 * `_authed.tsx` — token is checked pre-React; mode is checked here because the
 * matched routes' `staticData` is only available via `useMatches()`. Mirrors
 * `<AuthGate>`'s effect-then-redirect shape.
 *
 * Route guards are UX-only — the server is the security boundary.
 */
export function ModeGuard({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const mode = useAtomValue(userModeAtom);
  const navigate = useNavigate();
  const matches = useMatches();
  const redirectTo = resolveModeRedirect(
    mode,
    matches.map((m) => m.staticData.modes),
  );

  useEffect(() => {
    if (redirectTo) {
      void navigate({ to: redirectTo, replace: true });
    }
  }, [redirectTo, navigate]);

  // Render nothing while the redirect is in flight so the disallowed page
  // never flashes.
  return redirectTo ? null : children;
}
