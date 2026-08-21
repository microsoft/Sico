import type { AxiosInstance } from "axios";

import { unwrapEnvelope } from "./unwrap-envelope";
import {
  type RegisterNewUserResponse,
  registerNewUserResponseSchema,
} from "../../../schemas/auth";
import type { RegisterNewUserRequest } from "../../../types/auth";

class RegisterRejectedError extends Error {
  readonly kind = "rejected" as const;
  readonly code: number;
  readonly msg: string;

  constructor(code: number, msg: string) {
    super(msg);
    this.name = "RegisterRejectedError";
    this.code = code;
    this.msg = msg;
  }
}

class RegisterNetworkError extends Error {
  readonly kind = "network" as const;
  readonly msg: string;

  constructor(msg: string) {
    super(msg);
    this.name = "RegisterNetworkError";
    this.msg = msg;
  }
}

export type RegisterError = RegisterRejectedError | RegisterNetworkError;

export async function registerApi(
  client: AxiosInstance,
  request: RegisterNewUserRequest,
): Promise<RegisterNewUserResponse> {
  return unwrapEnvelope({
    client,
    path: "/rbac/user",
    body: request,
    context: "registerApi",
    dataSchema: registerNewUserResponseSchema,
    makeRejected: (code, msg) => new RegisterRejectedError(code, msg),
    makeNetwork: (msg) => new RegisterNetworkError(msg),
  });
}
