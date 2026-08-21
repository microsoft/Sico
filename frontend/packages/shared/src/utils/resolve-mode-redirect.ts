import { assertNever } from "./assert-never";
import type { LoginMode } from "../components/shell/login-mode-context";

// Where each mode lands: the developer studio vs the operator workspace.
// The single source for these landing paths — the route guard sends a
// disallowed user here, and the login wiring imports the same constants so a
// mode never lands on a path the guard would immediately bounce.
export const DEVELOPER_HOME = "/studio";
export const OPERATOR_HOME = "/digital-worker";

export type ModeHome = typeof DEVELOPER_HOME | typeof OPERATOR_HOME;

/** The landing route for a mode. Single mapping consumed by both the login
 * wiring (post-auth redirect) and `resolveModeRedirect` (bounce target). The
 * `switch` is exhaustive: adding a `LoginMode` fails the build at `assertNever`
 * until this mapping is extended — the seam future modes must pass through. */
export function homeForMode(mode: LoginMode): ModeHome {
  switch (mode) {
    case "operator":
      return OPERATOR_HOME;
    case "developer":
      return DEVELOPER_HOME;
    default:
      return assertNever(mode);
  }
}

/**
 * Pure access rule shared by the route guard. `matchedModes` is the per-match
 * `staticData.modes` in root→leaf order (`undefined` = the match declares no
 * restriction, i.e. a shared route). The deepest declared restriction wins; if
 * it excludes the current mode, the user is sent to their own home. Returns
 * `null` when access is allowed.
 */
export function resolveModeRedirect(
  mode: LoginMode,
  matchedModes: readonly (readonly LoginMode[] | undefined)[],
): ModeHome | null {
  const declared = matchedModes.filter((m) => m !== undefined).at(-1);
  if (declared && !declared.includes(mode)) {
    return homeForMode(mode);
  }
  return null;
}
