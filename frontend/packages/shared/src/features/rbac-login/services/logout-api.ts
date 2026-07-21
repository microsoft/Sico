// POST /rbac/logout → envelope validation. Authorization header is
// attached by the axios request interceptor (axios.ts:113-122). All
// failures throw a plain `Error` — callers don't branch on kind.
import type { AxiosInstance } from "axios";
import { z } from "zod";

import { HTTP_OK } from "../../../constants/http";
import { apiResponseSchema } from "../../../schemas/api";
import { logger } from "../../../utils/logger";

const envelopeSchema = apiResponseSchema(z.unknown());

export async function logoutApi(client: AxiosInstance): Promise<void> {
  let data: unknown;
  try {
    const response = await client.post("/rbac/logout");
    data = response.data;
  } catch (error) {
    logger.warn("logoutApi: axios request rejected", { error });
    throw new Error("logout: network unreachable");
  }
  const envelope = envelopeSchema.safeParse(data);
  if (!envelope.success) {
    logger.warn("logoutApi: malformed envelope", {
      issues: envelope.error.issues,
    });
    throw new Error("logout: malformed envelope");
  }
  if (envelope.data.code !== HTTP_OK) {
    logger.warn("logoutApi: server rejected", {
      code: envelope.data.code,
      msg: envelope.data.msg,
    });
    throw new Error("logout: server rejected");
  }
}
