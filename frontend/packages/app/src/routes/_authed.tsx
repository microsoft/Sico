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
