// Shared envelope-unwrap flow for the RBAC auth POST endpoints. `loginApi` and
// `registerApi` differ only in endpoint, body, success schema, and their two
// error classes — the parse → classify → validate flow is identical, so it
// lives here once. Each caller injects its own error factories so the exported
// discriminated unions (`kind: "credentials" | "rejected"` etc.) stay intact.
import type { AxiosInstance } from "axios";
import { z } from "zod";

import { CLIENT_NETWORK_ERROR_CODE, HTTP_OK } from "../../../constants/http";
import { apiResponseSchema } from "../../../schemas/api";
import { logger } from "../../../utils/logger";

const envelopeSchema = apiResponseSchema(z.unknown());

export type UnwrapEnvelopeOptions<T> = {
  readonly client: AxiosInstance;
  readonly path: string;
  readonly body: unknown;
  readonly context: string;
  readonly dataSchema: z.ZodType<T>;
  // A non-OK business `code` — the caller maps it to its own rejected error.
  readonly makeRejected: (code: number, msg: string) => Error;
  // Transport / malformed / schema failures and synthetic network codes.
  readonly makeNetwork: (msg: string) => Error;
};

export async function unwrapEnvelope<T>({
  client,
  path,
  body,
  context,
  dataSchema,
  makeRejected,
  makeNetwork,
}: UnwrapEnvelopeOptions<T>): Promise<T> {
  let responseData: unknown;
  try {
    const response = await client.post(path, body);
    responseData = response.data;
  } catch (error) {
    logger.warn(`${context}: axios request rejected`, { error });
    throw makeNetwork("network unreachable");
  }

  const envelope = envelopeSchema.safeParse(responseData);
  if (!envelope.success) {
    logger.warn(`${context}: malformed envelope`, {
      issues: envelope.error.issues,
    });
    throw makeNetwork("malformed envelope");
  }

  const { code, msg, data } = envelope.data;
  if (code === CLIENT_NETWORK_ERROR_CODE) {
    throw makeNetwork(msg);
  }
  if (code !== HTTP_OK) {
    throw makeRejected(code, msg);
  }

  const parsed = dataSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn(`${context}: schema parse failed`, {
      issues: parsed.error.issues,
    });
    throw makeNetwork("schema parse failed");
  }
  return parsed.data;
}
