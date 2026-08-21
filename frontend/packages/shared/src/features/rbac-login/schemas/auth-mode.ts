import { z } from "zod";

import type { LoginMode } from "../../../components/shell/login-mode-context";

export const authModeSearchSchema = z.object({
  mode: z.literal("developer").optional(),
});

export type AuthModeSearch = z.infer<typeof authModeSearchSchema>;

export function modeFromSearch(search: AuthModeSearch): LoginMode {
  return search.mode === "developer" ? "developer" : "operator";
}

export function searchForMode(mode: LoginMode): AuthModeSearch {
  return { mode: mode === "developer" ? "developer" : undefined };
}
