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
