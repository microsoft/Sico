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

// `_authed.tsx` filename + `Route` export are mandated by TanStack
// file-based routing.
//
// DEVIATION: deep-import from `@sico/shared/utils/auth-storage.ts`. The
// barrel hides `getAccessToken` so app code cannot bypass `userAtom`;
// this route's pre-React `beforeLoad` is the documented exception.
import {
  AppShell,
  AuthGate,
  buildLoginRedirect,
  ModeGuard,
} from "@sico/shared";
import { getAccessToken } from "@sico/shared/utils/auth-storage.ts";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import type { JSX } from "react";

// `beforeLoad` catches initial-render / SSR; `<AuthGate>` catches
// post-mount session loss.
export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ location }) => {
    if (!getAccessToken()) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `redirect()` is the documented control-flow signal
      throw redirect(buildLoginRedirect(location.pathname));
    }
  },
  component: AuthedLayout,
});

function AuthedLayout(): JSX.Element {
  return (
    <AppShell>
      <AuthGate>
        <ModeGuard>
          <Outlet />
        </ModeGuard>
      </AuthGate>
    </AppShell>
  );
}
