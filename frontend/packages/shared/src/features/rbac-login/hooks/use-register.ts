import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { RegisterNewUserResponse } from "../../../schemas/auth";
import { useApiClient } from "../../../services/api-client-context";
import type { RegisterNewUserRequest } from "../../../types/auth";
import { registerApi, type RegisterError } from "../services/register-api";

export type UseRegisterOptions = {
  readonly onSuccess: (data: RegisterNewUserResponse) => void;
  readonly onRejectedError: () => void;
  readonly onNetworkError: () => void;
};

type UseRegisterResult = Pick<
  UseMutationResult<
    RegisterNewUserResponse,
    RegisterError,
    RegisterNewUserRequest
  >,
  "isPending" | "mutate"
>;

export function useRegister(options: UseRegisterOptions): UseRegisterResult {
  const client = useApiClient();
  return useMutation<
    RegisterNewUserResponse,
    RegisterError,
    RegisterNewUserRequest
  >({
    mutationFn: (request) => registerApi(client, request),
    onSuccess: (data) => options.onSuccess(data),
    onError: (error) => {
      // The rejected `msg` (e.g. "email already exists") is never forwarded to
      // the UI — it leaks account existence and is uncontrolled server copy.
      // The form shows a fixed rejected string instead.
      if (error.kind === "rejected") {
        options.onRejectedError();
      } else {
        options.onNetworkError();
      }
    },
  });
}
