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

import {
  createContext,
  type Dispatch,
  type SetStateAction,
  useContext,
  useState,
} from "react";

// SICO has two faces: the operator workspace (SICO) and the developer studio
// (SICO.Dev). The login form toggles between them; the initial mode is
// "operator".
export type LoginMode = "operator" | "developer";

export type LoginModeValue = readonly [
  LoginMode,
  Dispatch<SetStateAction<LoginMode>>,
];

// `null` default = no provider. `useLoginMode` then falls back to a local
// `useState`, so a standalone `<LoginForm>` (no `<LoginLayout>` wrapper) still
// works and sico/app is unaffected.
const LoginModeContext = createContext<LoginModeValue | null>(null);

export { LoginModeContext };

/**
 * Shared `[mode, setMode]` for the login screen. `<LoginLayout>` provides it so
 * its header logo and the centered `<LoginForm>` (siblings) stay in sync on a
 * mode switch. Without a provider, returns component-local state — hooks are
 * always called, satisfying the rules-of-hooks.
 */
export function useLoginMode(): LoginModeValue {
  const ctx = useContext(LoginModeContext);
  // Always called (rules-of-hooks); used only when there's no provider.
  const local = useState<LoginMode>("operator");
  return ctx ?? local;
}
