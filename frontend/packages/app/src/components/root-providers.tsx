import {
  ApiClientProvider,
  I18nProvider,
  SicoConfigProvider,
} from "@sico/shared";
import { Toaster, TooltipProvider } from "@sico/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Provider as JotaiProvider } from "jotai";
import type { ReactElement } from "react";

import { router } from "@/router";
import { api } from "@/services/api";
import { queryClient } from "@/services/query-client";
import { store } from "@/store";

// Outer-boundary catch site for provider-factory throws (see app.tsx).
// `queryClient` and `api` are module-scope singletons defined in
// `services/`; the router already received them at construction, so no
// `context` prop is needed here.
export function RootProviders(): ReactElement {
  return (
    <JotaiProvider store={store}>
      <I18nProvider>
        <SicoConfigProvider
          config={{
            loginPrefillCredentials:
              import.meta.env.VITE_LOGIN_PREFILL_CREDENTIALS !== "false",
          }}
        >
          <QueryClientProvider client={queryClient}>
            <ApiClientProvider client={api}>
              <TooltipProvider>
                <RouterProvider router={router} />
                {/* Toast placement is a per-surface design decision owned
                    by @sico/ui (white bottom-right, black bottom-center). */}
                <Toaster />
              </TooltipProvider>
            </ApiClientProvider>
          </QueryClientProvider>
        </SicoConfigProvider>
      </I18nProvider>
    </JotaiProvider>
  );
}
