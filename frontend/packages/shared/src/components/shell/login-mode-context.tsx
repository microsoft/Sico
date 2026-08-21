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
