import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { useLogout } from "@/features/rbac-login/hooks/use-logout";
import { logoutApi } from "@/features/rbac-login/services/logout-api";
import { ApiClientProvider } from "@/services/api-client-context";

import { clearAuthStorage } from "../../../helpers/clear-auth-storage";

vi.mock("@/features/rbac-login/services/logout-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/rbac-login/services/logout-api")
  >("@/features/rbac-login/services/logout-api");
  return {
    ...actual,
    logoutApi: vi.fn(),
  };
});

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

const mockedLogoutApi = vi.mocked(logoutApi);

const seedUser = {
  id: 1,
  email: "a@b.co",
  roles: [
    { id: 1, roleCode: "project_admin", scopeType: "project", scopeId: 1 },
  ],
};

const apiClient = axios.create({ baseURL: "/api/sico" });

function makeWrapper(store: ReturnType<typeof createStore>): {
  Wrapper: (props: { children: ReactNode }) => ReactElement;
  clearSpy: ReturnType<typeof vi.spyOn>;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const clearSpy = vi.spyOn(queryClient, "clear");

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );
  }

  return { Wrapper, clearSpy };
}

describe("useLogout", () => {
  beforeEach(() => {
    mockedLogoutApi.mockReset();
    navigate.mockReset();
    clearAuthStorage();
  });

  it("on success: clears userAtom, clears queryClient, and navigates to /login", async () => {
    mockedLogoutApi.mockResolvedValue(undefined);
    const store = createStore();
    store.set(userAtom, seedUser);
    const { Wrapper, clearSpy } = makeWrapper(store);

    const { result } = renderHook(() => useLogout(), { wrapper: Wrapper });

    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(store.get(userAtom)).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
    expect(mockedLogoutApi).toHaveBeenCalledWith(apiClient);
  });

  it("on server failure: still clears userAtom, clears queryClient, navigates, and surfaces error", async () => {
    mockedLogoutApi.mockRejectedValue(new Error("network unreachable"));
    const store = createStore();
    store.set(userAtom, seedUser);
    const { Wrapper, clearSpy } = makeWrapper(store);

    const { result } = renderHook(() => useLogout(), { wrapper: Wrapper });

    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(store.get(userAtom)).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
