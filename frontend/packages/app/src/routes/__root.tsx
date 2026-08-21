import { useFocusFirstHeading } from "@sico/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";
// eslint-disable-next-line import-x/no-extraneous-dependencies -- dev-only, guarded by import.meta.env.DEV
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import type { AxiosInstance } from "axios";
import { type JSX, useRef } from "react";

// `queryClient` + `apiClient` are supplied by `<RouterProvider context={...}>`
// so route loaders (e.g. `/_authed/project`) can prefetch via react-query.
export type RouterContext = {
  queryClient: QueryClient;
  apiClient: AxiosInstance;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});

// No `<Suspense>` boundary — the route surface is synchronous today.
// When an async route lands, wrap `<Outlet />` so the fallback inherits
// the route tree's landmark structure.
function RootComponent(): JSX.Element {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </>
  );
}

// `<NotFound>` renders outside both `<LoginLayout>` and `<AppShell>`,
// so it owns its own `<main>` + `<h1>` + focus hook.
function NotFound(): JSX.Element {
  const mainRef = useRef<HTMLElement | null>(null);
  useFocusFirstHeading(mainRef);
  return (
    <main ref={mainRef} className="bg-background text-foreground p-6">
      <h1 tabIndex={-1} className="text-2xl font-medium">
        Page not found
      </h1>
      <p>The page you are looking for does not exist or has been moved.</p>
      <Link to="/digital-worker">Back to home</Link>
    </main>
  );
}
