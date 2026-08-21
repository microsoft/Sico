import { buildLoginRedirect, createApiClient } from "@sico/shared";
import { type AxiosInstance } from "axios";

import { router } from "@/router";
import { backendProfile } from "@/services/backend-profile";
import { store } from "@/store";

// `router.state.location.pathname` is read inside the closure so it
// captures the URL at the moment the 401 fires. `baseURL` comes from the
// build-time backend profile (sico → /api/sico, dwp → /api/dwp).
export const api: AxiosInstance = createApiClient({
  baseURL: backendProfile.baseURL,
  store,
  onUnauthorized: (): void => {
    void router.navigate(buildLoginRedirect(router.state.location.pathname));
  },
});
