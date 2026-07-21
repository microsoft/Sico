// POST /rbac/login → envelope → unwrap → zod parse. All failures
// normalize to a `LoginError` discriminated union (kind: credentials |
// network). Re-validates the envelope so tests can pass a raw axios
// instance bypassing the response interceptor.
import type { AxiosInstance, AxiosResponse } from "axios";
import { z } from "zod";

import { CLIENT_NETWORK_ERROR_CODE, HTTP_OK } from "../../../constants/http";
import { apiResponseSchema } from "../../../schemas/api";
import { type LoginResponse, loginResponseSchema } from "../../../schemas/auth";
import { logger } from "../../../utils/logger";
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

const envelopeSchema = apiResponseSchema(z.unknown());

export async function loginApi(
  client: AxiosInstance,
  values: LoginFormValues,
): Promise<LoginResponse> {
  let response: AxiosResponse<unknown>;
  try {
    response = await client.post("/rbac/login", {
      email: values.email,
      password: values.password,
    });
  } catch (error) {
    logger.warn("loginApi: axios request rejected", { error });
    throw new LoginNetworkError("network unreachable");
  }
  const envelope = envelopeSchema.safeParse(response.data);
  if (!envelope.success) {
    logger.warn("loginApi: malformed envelope", {
      issues: envelope.error.issues,
    });
    throw new LoginNetworkError("malformed envelope");
  }
  const { code, msg, data } = envelope.data;
  if (code === CLIENT_NETWORK_ERROR_CODE) {
    throw new LoginNetworkError(msg);
  }
  if (code !== HTTP_OK) {
    throw new LoginCredentialsError(code, msg);
  }
  const parsed = loginResponseSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn("loginApi: schema parse failed", {
      issues: parsed.error.issues,
    });
    throw new LoginNetworkError("schema parse failed");
  }
  return parsed.data;
}
