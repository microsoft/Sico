// POST /rbac/login → envelope → unwrap → zod parse. All failures normalize to
// a `LoginError` discriminated union (kind: credentials | network). Shares the
// envelope-unwrap flow with `registerApi` via `unwrapEnvelope`.
import type { AxiosInstance } from "axios";

import { unwrapEnvelope } from "./unwrap-envelope";
import { type LoginResponse, loginResponseSchema } from "../../../schemas/auth";
import type { LoginFormValues } from "../schemas/login-form";

// Two Error subclasses so `throw` satisfies `only-throw-error` while the
// exported `LoginError` union keeps a discriminated `kind` for narrowing.
class LoginCredentialsError extends Error {
  readonly kind = "credentials" as const;
  readonly code: number;
  readonly msg: string;

  constructor(code: number, msg: string) {
    super(msg);
    this.name = "LoginCredentialsError";
    this.code = code;
    this.msg = msg;
  }
}

class LoginNetworkError extends Error {
  readonly kind = "network" as const;
  readonly msg: string;

  constructor(msg: string) {
    super(msg);
    this.name = "LoginNetworkError";
    this.msg = msg;
  }
}

export type LoginError = LoginCredentialsError | LoginNetworkError;

export async function loginApi(
  client: AxiosInstance,
  values: LoginFormValues,
): Promise<LoginResponse> {
  return unwrapEnvelope({
    client,
    path: "/rbac/login",
    body: { email: values.email, password: values.password },
    context: "loginApi",
    dataSchema: loginResponseSchema,
    makeRejected: (code, msg) => new LoginCredentialsError(code, msg),
    makeNetwork: (msg) => new LoginNetworkError(msg),
  });
}
