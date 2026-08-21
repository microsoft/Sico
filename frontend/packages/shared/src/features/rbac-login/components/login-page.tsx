// `<LoginPage>` — the login route's component, extracted from the route so the
// route file stays a thin scaffold. Owns the 401-bounce toast, mode-switch
// navigation, and success landing; DWP mounts it through its own /login route.
import { toast } from "@sico/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import type { JSX } from "react";
import { useEffect } from "react";

import { LoginForm } from "./login-form";
import { userModeAtom } from "../../../atoms/user-mode-atom";
import { LoginLayout } from "../../../components/shell/login-layout";
import { HTTP_UNAUTHORIZED } from "../../../constants/http";
import { resolveLandingPath } from "../../../utils/resolve-landing-path";
import { homeForMode } from "../../../utils/resolve-mode-redirect";
import { modeFromSearch, searchForMode } from "../schemas/auth-mode";
import type { LoginSearch } from "../schemas/login-search";

export function LoginPage(): JSX.Element {
  // `useSearch`/`useNavigate` return `any` outside the app's route-type
  // registry (shared has no route augmentation). The route's `validateSearch`
  // already guarantees the shape at runtime, so annotate at this boundary.
  const search: LoginSearch = useSearch({ from: "/login" });
  const navigate = useNavigate({ from: "/login" });
  const mode = modeFromSearch(search);
  // Write mode through the atom (not `setUserMode` directly) so subscribers —
  // ModeGuard + sidebar — re-render immediately. Writing LS alone leaves the
  // atom's cached value stale until a full remount (page refresh).
  const setUserMode = useSetAtom(userModeAtom);

  // `beforeLoad` runs outside React, so the 401-bounce toast lives here.
  // Stripping `?code` after first render keeps refresh / back nav quiet.
  // Stable `id` lets sonner dedupe StrictMode's double-invoke.
  useEffect(() => {
    if (search.code === HTTP_UNAUTHORIZED) {
      toast.error("Your session has expired. Please sign in again.", {
        id: "session-expired",
      });
      void navigate({
        search: (previous: LoginSearch) => ({ ...previous, code: undefined }),
        replace: true,
      });
    }
  }, [search.code, navigate]);

  return (
    <LoginLayout
      mode={mode}
      onModeChange={(nextMode) => {
        void navigate({
          search: (previous: LoginSearch) => ({
            ...previous,
            mode: searchForMode(nextMode).mode,
          }),
        });
      }}
    >
      <LoginForm
        onRegister={(registrationMode) => {
          void navigate({
            to: "/register",
            search: searchForMode(registrationMode),
          });
        }}
        onSuccess={(_data, submittedMode) => {
          // Persist the submitted mode BEFORE navigating so the destination's
          // guard + sidebar read the right face. `next` (401 bounce) still
          // wins over the mode landing via `resolveLandingPath`.
          setUserMode(submittedMode);
          void navigate({
            to: resolveLandingPath(search, homeForMode(submittedMode)),
            replace: true,
          });
        }}
      />
    </LoginLayout>
  );
}
