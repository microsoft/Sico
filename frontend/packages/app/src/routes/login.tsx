import {
  HTTP_UNAUTHORIZED,
  LoginForm,
  LoginLayout,
  resolveLandingPath,
  userModeAtom,
} from "@sico/shared";
import { authCodeSchema } from "@sico/shared/features/rbac-login/schemas/auth-code.ts";
import {
  getAccessToken,
  getUserMode,
} from "@sico/shared/utils/auth-storage.ts";
import { homeForMode } from "@sico/shared/utils/resolve-mode-redirect.ts";
import { toast } from "@sico/ui";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import type { JSX } from "react";
import { useEffect } from "react";
import { z } from "zod";

import { router } from "@/router";

// `{ code, next }` from `buildLoginRedirect`. Both optional —
// direct visit or 401 bounce.
const loginSearchSchema = z.object({
  code: authCodeSchema.optional(),
  next: z.string().max(2048).optional(),
});

export type LoginSearch = z.infer<typeof loginSearchSchema>;

export const Route = createFileRoute("/login")({
  validateSearch: loginSearchSchema,
  // Pre-React guard — mirrors `_authed.tsx`; redirects already-authed
  // visits straight to the landing page for their persisted mode.
  beforeLoad: ({ search }) => {
    if (getAccessToken()) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `redirect()` is the documented control-flow signal
      throw redirect({
        to: resolveLandingPath(search, homeForMode(getUserMode())),
      });
    }
  },
  component: LoginPage,
});

function LoginPage(): JSX.Element {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
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
        search: (prev) => ({ ...prev, code: undefined }),
        replace: true,
      });
    }
  }, [search.code, navigate]);

  return (
    <LoginLayout>
      <LoginForm
        onSuccess={(_data, mode) => {
          // Persist the submitted mode BEFORE navigating so the destination's
          // guard + sidebar read the right face. `next` (401 bounce) still
          // wins over the mode landing via `resolveLandingPath`.
          setUserMode(mode);
          void router.navigate({
            to: resolveLandingPath(search, homeForMode(mode)),
            replace: true,
          });
        }}
      />
    </LoginLayout>
  );
}
