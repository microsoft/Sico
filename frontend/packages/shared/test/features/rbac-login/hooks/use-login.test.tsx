import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { useLogin } from "@/features/rbac-login/hooks/use-login";
// Pulled after the mock so the hook receives the mocked module.
import {
  loginApi,
  type LoginError,
} from "@/features/rbac-login/services/login-api";
import { ApiClientProvider } from "@/services/api-client-context";

import { clearAuthStorage } from "../../../helpers/clear-auth-storage";

vi.mock("@/features/rbac-login/services/login-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/rbac-login/services/login-api")
  >("@/features/rbac-login/services/login-api");
  return {
    ...actual,
    loginApi: vi.fn(),
  };
});

const mockedLoginApi = vi.mocked(loginApi);

const successPayload = {
  tokenInfo: { accessToken: "tok", expiresAt: 1_900_000_000 },
  user: {
    id: 1,
    email: "a@b.co",
    roles: [
      { id: 1, roleCode: "project_admin", scopeType: "project", scopeId: 1 },
    ],
  },
};

const apiClient = axios.create({ baseURL: "/api/sico" });
const values = { email: "a@b.co", password: "123456" };

function makeWrapper(store: ReturnType<typeof createStore>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );
  };
}

describe("useLogin", () => {
  beforeEach(() => {
    mockedLoginApi.mockReset();
    clearAuthStorage();
  });

  it("on success: writes to userAtom and invokes onSuccess with parsed data", async () => {
    mockedLoginApi.mockResolvedValue(successPayload);
    const onSuccess = vi.fn();
    const store = createStore();

    const { result } = renderHook(
      () =>
        useLogin({
          onSuccess,
          onCredentialsError: vi.fn(),
          onNetworkError: vi.fn(),
        }),
      { wrapper: makeWrapper(store) },
    );

    result.current.mutate(values);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(successPayload);
    });
    expect(store.get(userAtom)).toMatchObject({ id: 1, email: "a@b.co" });
    expect(mockedLoginApi).toHaveBeenCalledWith(apiClient, values);
  });

  it("on credentials error: invokes onCredentialsError with msg and does NOT write to userAtom", async () => {
    const credentialsError: LoginError = Object.assign(new Error("incorrect"), {
      kind: "credentials" as const,
      code: 40001,
      msg: "incorrect password",
    });
    mockedLoginApi.mockRejectedValue(credentialsError);
    const onCredentialsError = vi.fn();
    const onNetworkError = vi.fn();
    const store = createStore();

    const { result } = renderHook(
      () =>
        useLogin({
          onSuccess: vi.fn(),
          onCredentialsError,
          onNetworkError,
        }),
      { wrapper: makeWrapper(store) },
    );

    result.current.mutate(values);

    await waitFor(() => {
      expect(onCredentialsError).toHaveBeenCalledWith("incorrect password");
    });
    expect(onNetworkError).not.toHaveBeenCalled();
    expect(store.get(userAtom)).toBeNull();
  });

  it("on network error: invokes onNetworkError with msg and does NOT write to userAtom", async () => {
    const networkError: LoginError = Object.assign(new Error("offline"), {
      kind: "network" as const,
      msg: "network unreachable",
    });
    mockedLoginApi.mockRejectedValue(networkError);
    const onCredentialsError = vi.fn();
    const onNetworkError = vi.fn();
    const store = createStore();

    const { result } = renderHook(
      () =>
        useLogin({
          onSuccess: vi.fn(),
          onCredentialsError,
          onNetworkError,
        }),
      { wrapper: makeWrapper(store) },
    );

    result.current.mutate(values);

    await waitFor(() => {
      expect(onNetworkError).toHaveBeenCalledWith("network unreachable");
    });
    expect(onCredentialsError).not.toHaveBeenCalled();
    expect(store.get(userAtom)).toBeNull();
  });
});
