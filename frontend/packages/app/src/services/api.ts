import {
  API_BASE_URL,
  buildLoginRedirect,
  createApiClient,
  getBoundOrganizationId,
} from "@sico/shared";
import { type AxiosInstance } from "axios";

import { router } from "@/router";
import { queryClient } from "@/services/query-client";
import { store } from "@/store";

// `router.state.location.pathname` is read inside the closure so it
// captures the URL at the moment the 401 fires.
export const api: AxiosInstance = createApiClient({
  baseURL: API_BASE_URL,
  store,
  getOrganizationId: () => getBoundOrganizationId(store, queryClient),
  onUnauthorized: (): void => {
    queryClient.clear();
    void router.navigate(buildLoginRedirect(router.state.location.pathname));
  },
});
