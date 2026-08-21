import { ApiClientProvider, SicoConfigProvider } from "@sico/shared";
import { Toaster, TooltipProvider } from "@sico/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as JotaiProvider } from "jotai";
import { LucideProvider } from "lucide-react";
import type { ReactElement } from "react";

import { router } from "@/router";
import { api } from "@/services/api";
import { backendProfile } from "@/services/backend-profile";
import { queryClient } from "@/services/query-client";
import { store } from "@/store";

// Per-backend sico config (chat endpoints + declarative flags) selected at
// build time. A static module constant — no hook deps, so no `useMemo`.
const sicoConfig = {
  ...backendProfile.sicoFlags,
  chatEndpoints: backendProfile.chatEndpoints,
};

// Outer-boundary catch site for provider-factory throws (see app.tsx).
// `queryClient` and `api` are module-scope singletons defined in
// `services/`; the router already received them at construction, so no
// `context` prop is needed here.
export function RootProviders(): ReactElement {
  return (
    <JotaiProvider store={store}>
      <SicoConfigProvider config={sicoConfig}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={api}>
            <LucideProvider strokeWidth={1}>
              <TooltipProvider>
                <RouterProvider router={router} />
                {/* Toast placement is a per-surface design decision owned
                    by @sico/ui (white bottom-right, black bottom-center). */}
                <Toaster />
              </TooltipProvider>
            </LucideProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SicoConfigProvider>
    </JotaiProvider>
  );
}
