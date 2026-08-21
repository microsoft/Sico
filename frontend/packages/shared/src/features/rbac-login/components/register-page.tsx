// `<RegisterPage>` — the register route's component, extracted from the route
// so the route file stays a thin scaffold. Owns the success toast, the 2s
// redirect-to-login timer, and its unmount guards; DWP mounts it through its
// own /register route.
import { toast } from "@sico/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { JSX } from "react";
import { useEffect, useRef } from "react";

import { RegisterForm } from "./register-form";
import { LoginLayout } from "../../../components/shell/login-layout";
import type { LoginMode } from "../../../components/shell/login-mode-context";
import {
  type AuthModeSearch,
  modeFromSearch,
  searchForMode,
} from "../schemas/auth-mode";

export function RegisterPage(): JSX.Element {
  // `useSearch`/`useNavigate` return `any` outside the app's route-type
  // registry (shared has no route augmentation). The route's `validateSearch`
  // already guarantees the shape at runtime, so annotate at this boundary.
  const search: AuthModeSearch = useSearch({ from: "/register" });
  const navigate = useNavigate({ from: "/register" });
  const mode = modeFromSearch(search);
  const isMountedRef = useRef(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const navigateToLogin = (loginMode: LoginMode): void => {
    void navigate({
      to: "/login",
      search: searchForMode(loginMode),
    });
  };

  return (
    <LoginLayout
      mode={mode}
      onModeChange={(nextMode) => {
        void navigate({
          search: (previous: AuthModeSearch) => ({
            ...previous,
            mode: searchForMode(nextMode).mode,
          }),
        });
      }}
    >
      <RegisterForm
        onLogin={navigateToLogin}
        onSuccess={(_data, submittedMode) => {
          if (!isMountedRef.current || redirectTimerRef.current) {
            return;
          }

          toast.success("Account Created", { id: "account-created" });
          redirectTimerRef.current = setTimeout(() => {
            void navigate({
              to: "/login",
              search: searchForMode(submittedMode),
              replace: true,
            });
          }, 2000);
        }}
      />
    </LoginLayout>
  );
}
