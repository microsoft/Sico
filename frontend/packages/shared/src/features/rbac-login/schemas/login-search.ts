// `{ code, next }` from `buildLoginRedirect`. Both optional —
// direct visit or 401 bounce. Lives here (not the route) so the route
// stays a thin scaffold and DWP can reuse the same search contract.
import { z } from "zod";

import { authCodeSchema } from "./auth-code";
import { authModeSearchSchema } from "./auth-mode";

export const loginSearchSchema = z.object({
  ...authModeSearchSchema.shape,
  code: authCodeSchema.optional(),
  next: z.string().max(2048).optional(),
});

export type LoginSearch = z.infer<typeof loginSearchSchema>;
