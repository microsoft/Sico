import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import axios from "axios";
import type { JSX, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRegister } from "@/features/rbac-login/hooks/use-register";
import {
  registerApi,
  type RegisterError,
} from "@/features/rbac-login/services/register-api";
import { ApiClientProvider } from "@/services/api-client-context";
import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  getItemFromLocalStorage,
} from "@/utils/local-storage";

import { clearAuthStorage } from "../../../helpers/clear-auth-storage";

vi.mock("@/features/rbac-login/services/register-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/rbac-login/services/register-api")
  >("@/features/rbac-login/services/register-api");
  return { ...actual, registerApi: vi.fn() };
});

const mockedRegisterApi = vi.mocked(registerApi);
const apiClient = axios.create({ baseURL: "/api/sico" });
const values = { email: "person@example.com", password: "12345678" };

function Wrapper({ children }: { readonly children: ReactNode }): JSX.Element {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

describe("useRegister", () => {
  beforeEach(() => {
    mockedRegisterApi.mockReset();
    clearAuthStorage();
  });

  it("returns success without writing login storage", async () => {
    mockedRegisterApi.mockResolvedValue({ id: "user-1" });
    const onSuccess = vi.fn();
    const onRejectedError = vi.fn();
    const onNetworkError = vi.fn();
    const { result } = renderHook(
      () => useRegister({ onSuccess, onRejectedError, onNetworkError }),
      { wrapper: Wrapper },
    );

    result.current.mutate(values);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ id: "user-1" });
    });
    expect(mockedRegisterApi).toHaveBeenCalledWith(apiClient, values);
    expect(onRejectedError).not.toHaveBeenCalled();
    expect(onNetworkError).not.toHaveBeenCalled();
    expect(getItemFromLocalStorage(AUTH_TOKEN_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_USER_LS)).toBeNull();
    expect(getItemFromLocalStorage(AUTH_EXPIRES_AT_LS)).toBeNull();
  });

  it("routes business rejection to onRejectedError", async () => {
    const error: RegisterError = Object.assign(new Error("rejected"), {
      kind: "rejected" as const,
      code: 101009,
      msg: "email already exists",
    });
    mockedRegisterApi.mockRejectedValue(error);
    const onRejectedError = vi.fn();
    const onNetworkError = vi.fn();
    const { result } = renderHook(
      () =>
        useRegister({
          onSuccess: vi.fn(),
          onRejectedError,
          onNetworkError,
        }),
      { wrapper: Wrapper },
    );

    result.current.mutate(values);

    await waitFor(() => {
      expect(onRejectedError).toHaveBeenCalledOnce();
    });
    expect(onNetworkError).not.toHaveBeenCalled();
  });

  it("routes transport and parsing failures to onNetworkError", async () => {
    const error: RegisterError = Object.assign(new Error("offline"), {
      kind: "network" as const,
      msg: "network unreachable",
    });
    mockedRegisterApi.mockRejectedValue(error);
    const onRejectedError = vi.fn();
    const onNetworkError = vi.fn();
    const { result } = renderHook(
      () =>
        useRegister({
          onSuccess: vi.fn(),
          onRejectedError,
          onNetworkError,
        }),
      { wrapper: Wrapper },
    );

    result.current.mutate(values);

    await waitFor(() => {
      expect(onNetworkError).toHaveBeenCalledOnce();
    });
    expect(onRejectedError).not.toHaveBeenCalled();
  });
});
