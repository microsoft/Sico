import axios from "axios";
import { z } from "zod";

import { EnvelopeError } from "../schemas/api";

const errorEnvelopeSchema = z.object({ msg: z.string().min(1) });

// Backend `msg` values that are internal/technical rather than user-facing —
// e.g. Go struct-validator output like
// "Key: 'CreateSingleAgentInstanceRequest.ProjectId' Error:...required".
// Matched by the validator's own `Key: '…' Error:` shape (not a bare `Error:`,
// which would swallow legitimate sentences like "Error: name already taken").
const TECHNICAL_MSG = /Key:\s*'.+?'\s*Error:|validation for/i;

// Per-code friendly overrides. Empty today — the hook exists so a specific
// backend `code` can be mapped to nicer copy later WITHOUT touching call sites
// (e.g. `101004: "This user is already a member of the project."`). An unmapped
// code falls through to the backend `msg`.
const CODE_MESSAGES: Record<number, string> = {};

// A backend `msg` is user-facing unless it's empty or an internal validator
// string — either case falls back to the caller's generic copy.
function fromBackendMsg(msg: string, fallback: string): string {
  return msg.length === 0 || TECHNICAL_MSG.test(msg) ? fallback : msg;
}

/**
 * Best-effort user-facing message from a mutation/query error, for a toast.
 * Order: a per-`code` friendly override → the backend envelope `msg` when it
 * reads like a human sentence → the provided generic fallback. Handles both an
 * `EnvelopeError` (non-OK `{code,msg}` surfaced by `assertOk` on an HTTP-200
 * envelope) and a real HTTP error carrying `{ msg }` in its body.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof EnvelopeError) {
    return CODE_MESSAGES[error.code] ?? fromBackendMsg(error.msg, fallback);
  }
  if (axios.isAxiosError(error)) {
    const parsed = errorEnvelopeSchema.safeParse(error.response?.data);
    if (parsed.success) {
      return fromBackendMsg(parsed.data.msg, fallback);
    }
  }
  return fallback;
}
