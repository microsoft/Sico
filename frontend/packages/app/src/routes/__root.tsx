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
