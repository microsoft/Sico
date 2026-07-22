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

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect } from "react";

import { userAtom } from "../../atoms/auth-atom";
import { buildLoginRedirect } from "../../utils/build-login-redirect";

type AuthGateProps = {
  readonly children: ReactNode;
};

/**
 * Runtime auth gate. Pairs with the synchronous `beforeLoad` redirect
 * in the consuming app's `_authed.tsx` — defence in depth for when the
 * session transitions to `null` after the route has loaded.
 *
 * Route guards are UX-only — the server is the security boundary.
 */
export function AuthGate({ children }: AuthGateProps): ReactNode {
  const user = useAtomValue(userAtom);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    // `/login` short-circuit prevents the post-navigation re-fire from
    // clobbering the original `next` query string.
    if (!user && pathname !== "/login") {
      void navigate(buildLoginRedirect(pathname));
    }
  }, [user, navigate, pathname]);

  return user ? children : null;
}
