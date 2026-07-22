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

import axios from "axios";
import { z } from "zod";

const errorEnvelopeSchema = z.object({ msg: z.string().min(1) });

// Backend `msg` values that are internal/technical rather than user-facing —
// e.g. Go struct-validator output like
// "Key: 'CreateSingleAgentInstanceRequest.ProjectId' Error:...required".
// Matched by the validator's own `Key: '…' Error:` shape (not a bare `Error:`,
// which would swallow legitimate sentences like "Error: name already taken").
const TECHNICAL_MSG = /Key:\s*'.+?'\s*Error:|validation for/i;

/**
 * Best-effort user-facing message from a mutation/query error, for a toast.
 * Prefers the backend envelope `msg` when it reads like a human sentence;
 * skips internal validator strings; falls back to the provided generic message.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const parsed = errorEnvelopeSchema.safeParse(error.response?.data);
    if (parsed.success && !TECHNICAL_MSG.test(parsed.data.msg)) {
      return parsed.data.msg;
    }
  }
  return fallback;
}
