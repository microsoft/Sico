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

import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";
import { api } from "./services/api";
import { queryClient } from "./services/query-client";

// `beforeLoad` handlers run pre-React (no hooks), so they must only
// depend on module-scope singletons or pure functions. `<AuthGate>` is
// the React-context counterpart — together they form defence-in-depth.
//
// The router context is filled at construction with the real singletons
// (`queryClient`, `api`). A circular import with `./services/api` is
// safe because `api.ts` only dereferences `router` inside a closure
// (`onUnauthorized`), so by the time that closure runs `router` is
// fully initialised.
export const router = createRouter({
  routeTree,
  context: { queryClient, apiClient: api },
});

declare module "@tanstack/react-router" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- TanStack Router's public API uses `interface` for module-augmentation merging
  interface Register {
    router: typeof router;
  }
}
