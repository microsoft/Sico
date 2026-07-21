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
