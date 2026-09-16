import {
  QueryClient,
  QueryClientProvider,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios, { type AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import { type ReactElement, type ReactNode, Suspense } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import {
  boundOrganizationQueryOptions,
  userOrganizationsQueryOptions,
  useUserOrganizationsQuery,
} from "@/features/organization/hooks/use-organization-query";
import { organizationKeys } from "@/features/organization/query-keys";
import * as organizationService from "@/features/organization/services/organization";
import {
  useBoundOrganizationQuery,
  useBoundOrganizationSuspenseQuery,
} from "@/hooks/use-bound-organization";
import { ApiClientProvider } from "@/services/api-client-context";
import { persistLoginPayload } from "@/utils/auth-storage";
import {
  SELECTED_ORGANIZATION_ID_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import { makeLoginPayload } from "../../../helpers/organization-context";

vi.mock("@/features/organization/services/organization");

const organization = {
  id: 9,
  name: "SICO",
  description: "",
  createdAt: 1,
  updatedAt: 1,
  creatorUsername: "owner@example.com",
  roleCodes: ["org_member" as const],
  isOwner: false,
};

function QueryErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps): ReactElement {
  return (
    <div role="alert">
      <span>{error instanceof Error ? error.message : "failed"}</span>
      <button type="button" onClick={resetErrorBoundary}>
        Try again
      </button>
    </div>
  );
}

function QueryBoundary({ children }: { children: ReactNode }): ReactElement {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary onReset={reset} FallbackComponent={QueryErrorFallback}>
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function makeWrapper(queryClient: QueryClient): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  apiClient: AxiosInstance;
  store: ReturnType<typeof createStore>;
} {
  const store = createStore();
  store.set(userAtom, { id: 7, email: "user@example.com", roles: [] });
  const apiClient = axios.create();

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={apiClient}>
            <QueryBoundary>{children}</QueryBoundary>
          </ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  }

  return { Wrapper, apiClient, store };
}

beforeEach(() => {
  persistLoginPayload(makeLoginPayload());
  vi.mocked(organizationService.fetchUserOrganizations).mockReset();
});

describe("organization summary queries", () => {
  it("selects the requested organization without changing the list query key", () => {
    const apiClient = axios.create();
    const selected = { ...organization, id: 10, name: "Another organization" };
    const options = boundOrganizationQueryOptions(apiClient, 7, selected.id);

    expect(options.select?.([organization, selected])).toEqual(selected);
    expect(options.queryKey).toEqual(organizationKeys.userOrganizations(7));
  });

  it("shares one cache entry between bound and list observers", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
      organization,
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { Wrapper, apiClient } = makeWrapper(queryClient);
    await queryClient.prefetchQuery(
      boundOrganizationQueryOptions(apiClient, 7),
    );

    const { result } = renderHook(
      () => ({
        bound: useBoundOrganizationQuery(),
        suspenseBound: useBoundOrganizationSuspenseQuery(),
        list: useUserOrganizationsQuery(),
      }),
      { wrapper: Wrapper },
    );

    expect(result.current.bound.data).toEqual(organization);
    expect(result.current.suspenseBound.data).toEqual(organization);
    expect(result.current.list.data).toEqual([organization]);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([organization]);
  });

  it("updates both mounted bound observers while preserving the full list cache", async () => {
    const nextOrganization = {
      ...organization,
      id: 10,
      name: "Organization B",
    };
    const organizations = [organization, nextOrganization];
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue(
      organizations,
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { Wrapper, apiClient, store } = makeWrapper(queryClient);
    await queryClient.prefetchQuery(
      userOrganizationsQueryOptions(apiClient, 7),
    );
    const cachedList = queryClient.getQueryData(
      organizationKeys.userOrganizations(7),
    );
    const { result } = renderHook(
      () => ({
        bound: useBoundOrganizationQuery(),
        suspenseBound: useBoundOrganizationSuspenseQuery(),
        list: useUserOrganizationsQuery(),
      }),
      { wrapper: Wrapper },
    );
    expect(result.current.bound.data).toEqual(organization);
    expect(result.current.suspenseBound.data).toEqual(organization);

    act(() => store.set(selectedOrganizationIdAtom, nextOrganization.id));

    await waitFor(() =>
      expect({
        bound: result.current.bound.data,
        suspenseBound: result.current.suspenseBound.data,
      }).toEqual({ bound: nextOrganization, suspenseBound: nextOrganization }),
    );
    expect(result.current.list.data).toEqual(organizations);
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toBe(cachedList);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledOnce();
  });

  it("restores the selected organization for both bound observers", () => {
    const selected = { ...organization, id: 10, name: "Organization B" };
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, String(selected.id));
    const queryClient = new QueryClient();
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      organization,
      selected,
    ]);
    const { Wrapper } = makeWrapper(queryClient);

    const { result } = renderHook(
      () => ({
        bound: useBoundOrganizationQuery(),
        suspenseBound: useBoundOrganizationSuspenseQuery(),
      }),
      { wrapper: Wrapper },
    );

    expect(result.current.bound.data).toEqual(selected);
    expect(result.current.suspenseBound.data).toEqual(selected);
  });

  it.each(["999", "not-json", '"10"', "null"])(
    "falls back to the first organization for stored selection %s",
    (storedSelection) => {
      setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, storedSelection);
      const queryClient = new QueryClient();
      queryClient.setQueryData(organizationKeys.userOrganizations(7), [
        organization,
        { ...organization, id: 10, name: "Organization B" },
      ]);
      const { Wrapper } = makeWrapper(queryClient);

      const { result } = renderHook(
        () => ({
          bound: useBoundOrganizationQuery(),
          suspenseBound: useBoundOrganizationSuspenseQuery(),
        }),
        { wrapper: Wrapper },
      );

      expect(result.current.bound.data).toEqual(organization);
      expect(result.current.suspenseBound.data).toEqual(organization);
    },
  );

  it("returns null from both bound observers for a stored selection with an empty list", () => {
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "9");
    const queryClient = new QueryClient();
    queryClient.setQueryData(organizationKeys.userOrganizations(7), []);
    const { Wrapper } = makeWrapper(queryClient);

    const { result } = renderHook(
      () => ({
        bound: useBoundOrganizationQuery(),
        suspenseBound: useBoundOrganizationSuspenseQuery(),
      }),
      { wrapper: Wrapper },
    );

    expect(result.current.bound.data).toBeNull();
    expect(result.current.suspenseBound.data).toBeNull();
  });

  it("resolves a persisted selection only against the current user's organization list", async () => {
    const selected = { ...organization, id: 10, name: "User A organization" };
    const otherUserOrganization = {
      ...organization,
      id: 11,
      name: "User B organization",
    };
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, String(selected.id));
    const queryClient = new QueryClient();
    queryClient.setQueryData(organizationKeys.userOrganizations(7), [
      organization,
      selected,
    ]);
    queryClient.setQueryData(organizationKeys.userOrganizations(8), [
      otherUserOrganization,
    ]);
    const { Wrapper, store } = makeWrapper(queryClient);
    const { result } = renderHook(
      () => ({
        bound: useBoundOrganizationQuery(),
        suspenseBound: useBoundOrganizationSuspenseQuery(),
        list: useUserOrganizationsQuery(),
      }),
      { wrapper: Wrapper },
    );
    expect(result.current.bound.data).toEqual(selected);
    expect(result.current.suspenseBound.data).toEqual(selected);

    act(() =>
      store.set(userAtom, { id: 8, email: "other@example.com", roles: [] }),
    );

    await waitFor(() =>
      expect({
        bound: result.current.bound.data,
        suspenseBound: result.current.suspenseBound.data,
      }).toEqual({
        bound: otherUserOrganization,
        suspenseBound: otherUserOrganization,
      }),
    );
    expect(result.current.list.data).toEqual([otherUserOrganization]);
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual([organization, selected]);
    expect(store.get(selectedOrganizationIdAtom)).toBeNull();
  });

  it("returns null when the authenticated user has no bound organization", async () => {
    vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { Wrapper, apiClient } = makeWrapper(queryClient);
    await queryClient.prefetchQuery(
      boundOrganizationQueryOptions(apiClient, 7),
    );

    const { result } = renderHook(() => useBoundOrganizationSuspenseQuery(), {
      wrapper: Wrapper,
    });

    expect(result.current.data).toBeNull();
  });

  it("stays fail-closed while retrying a stale refetch error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let resolveRetry: (
      organizations: (typeof organization)[],
    ) => void = () => {};
    const retry = new Promise<(typeof organization)[]>((resolve) => {
      resolveRetry = resolve;
    });
    vi.mocked(organizationService.fetchUserOrganizations)
      .mockRejectedValueOnce(new Error("organization failed"))
      .mockReturnValueOnce(retry);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      organizationKeys.userOrganizations(7),
      [organization],
      { updatedAt: 0 },
    );
    const { Wrapper } = makeWrapper(queryClient);
    const user = userEvent.setup();
    const { result } = renderHook(() => useBoundOrganizationSuspenseQuery(), {
      wrapper: Wrapper,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "organization failed",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(result.current.data).toBeNull());

    await act(async () => {
      resolveRetry([organization]);
      await retry;
    });
    await waitFor(() => expect(result.current.data).toEqual(organization));
    expect(organizationService.fetchUserOrganizations).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it("uses a separate key for each authenticated user", () => {
    expect(organizationKeys.userOrganizations(7)).not.toEqual(
      organizationKeys.userOrganizations(8),
    );
  });

  it("does not request summaries without an authenticated user", async () => {
    const queryClient = new QueryClient();
    const apiClient = axios.create();

    await queryClient.fetchQuery(
      userOrganizationsQueryOptions(apiClient, null),
    );

    expect(organizationService.fetchUserOrganizations).not.toHaveBeenCalled();
  });
});
