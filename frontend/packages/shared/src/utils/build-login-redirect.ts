// Shared "kick user to /login" payload — used by route guards
// (`_authed.tsx#beforeLoad`, `<AuthGate>`) and the axios 401 hook so
// all three build the same shape that `routes/login.tsx#validateSearch` parses.
import { HTTP_UNAUTHORIZED } from "../constants/http";

export function buildLoginRedirect(pathname: string): {
  readonly to: "/login";
  readonly search: {
    readonly code: typeof HTTP_UNAUTHORIZED;
    readonly next: string;
  };
} {
  return {
    to: "/login",
    search: { code: HTTP_UNAUTHORIZED, next: pathname },
  };
}
