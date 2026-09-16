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
  ErrorView,
  getBoundOrganizationId,
  logoutAtom,
  userAtom,
} from "@sico/shared";
import { initializeOrganizationContext } from "@sico/shared/features/organization/index.ts";
import { getAccessToken } from "@sico/shared/utils/auth-storage.ts";
import { Spinner } from "@sico/ui";
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import type { JSX } from "react";

import type { RouterContext } from "./__root";

// `beforeLoad` catches initial-render / SSR; `<AuthGate>` catches
// post-mount session loss.
export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context, location, abortController }) => {
    const session = requireSession(context, location.pathname);
    try {
      await initializeOrganizationContext(
        context.apiClient,
        context.queryClient,
        session.userId,
      );
    } finally {
      // A canceled navigation must never redirect, log out a newer session,
      // or resume descendant loaders, including when initialization rejects.
      abortController.signal.throwIfAborted();
      assertSameSession(context, location.pathname, session);
    }
    const isOrganizationRoute =
      location.pathname === "/organization" ||
      location.pathname.startsWith("/organization/");
    if (
      getBoundOrganizationId(context.store, context.queryClient) === null &&
      !isOrganizationRoute
    ) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's redirect is its documented control-flow signal
      throw redirect({ to: "/organization/members", replace: true });
    }
  },
  component: AuthedLayout,
  pendingComponent: OrganizationPending,
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: OrganizationError,
});

type Session = { userId: number; token: string };

function requireSession(context: RouterContext, pathname: string): Session {
  const token = getAccessToken();
  const user = context.store.get(userAtom);
  if (!token || !user) {
    context.store.set(logoutAtom);
    context.queryClient.clear();
    // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's redirect is its documented control-flow signal
    throw redirect(buildLoginRedirect(pathname));
  }
  return { userId: user.id, token };
}

function assertSameSession(
  context: RouterContext,
  pathname: string,
  session: Session,
): void {
  const current = requireSession(context, pathname);
  if (current.userId !== session.userId || current.token !== session.token) {
    throw new Error("The session changed during organization initialization.");
  }
}

function OrganizationPending(): JSX.Element {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

const organizationError = new Error("Organization initialization failed.");

function OrganizationError(): JSX.Element {
  const router = useRouter();
  return (
    <ErrorView
      error={organizationError}
      resetErrorBoundary={() => {
        void router.invalidate();
      }}
    />
  );
}

function AuthedLayout(): JSX.Element {
  return (
    <AppShell>
      <AuthGate>
        <Outlet />
      </AuthGate>
    </AppShell>
  );
}
