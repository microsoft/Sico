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
