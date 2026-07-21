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
