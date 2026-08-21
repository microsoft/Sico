// `useMutation` wrapper that splits `loginApi`'s credentials / network
// errors into separate callbacks, and writes the success payload to
// `loginAtom` (LS + userAtom).
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useSetAtom } from "jotai";

import { loginAtom } from "../../../atoms/auth-atom";
import type { LoginResponse } from "../../../schemas/auth";
import { useApiClient } from "../../../services/api-client-context";
import type { LoginFormValues } from "../schemas/login-form";
import { loginApi, type LoginError } from "../services/login-api";

export type UseLoginOptions = {
  onSuccess: (data: LoginResponse) => void;
  onCredentialsError: (msg: string) => void;
  onNetworkError: (msg: string) => void;
};

export function useLogin(
  options: UseLoginOptions,
): UseMutationResult<LoginResponse, LoginError, LoginFormValues> {
  const apiClient = useApiClient();
  const setLogin = useSetAtom(loginAtom);
  return useMutation<LoginResponse, LoginError, LoginFormValues>({
    mutationFn: (values) => loginApi(apiClient, values),
    onSuccess: (data) => {
      setLogin(data);
      options.onSuccess(data);
    },
    onError: (error) => {
      if (error.kind === "credentials") {
        options.onCredentialsError(error.msg);
      } else {
        options.onNetworkError(error.msg);
      }
    },
  });
}
