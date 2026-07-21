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
