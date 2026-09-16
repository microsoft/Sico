import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { createStore, Provider } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { useUpdateOrganization } from "@/features/organization/hooks/use-update-organization";
import { organizationKeys } from "@/features/organization/query-keys";
import * as organizationService from "@/features/organization/services/organization";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/organization/services/organization");

function makeWrapper(): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  queryClient: QueryClient;
} {
  const store = createStore();
  store.set(userAtom, { id: 7, email: "user@example.com", roles: [] });
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={axios.create()}>
            {children}
          </ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  }

  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.mocked(organizationService.updateOrganization)
    .mockReset()
    .mockResolvedValue(undefined);
});

describe("useUpdateOrganization", () => {
  it("invalidates detail and the current user's summaries", async () => {
    const { Wrapper, queryClient } = makeWrapper();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateOrganization(9), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({ name: "Renamed" });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: organizationKeys.detail(9),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: organizationKeys.userOrganizations(7),
      exact: true,
    });
  });
});
