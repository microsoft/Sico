/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
