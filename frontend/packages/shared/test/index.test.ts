import { describe, expect, it } from "vitest";

import * as shared from "@/index";

// Regression lock — fails on removal of a known public name.
describe("@sico/shared barrel", () => {
  it.each([
    "logger",
    "buildLoginRedirect",
    "resolveLandingPath",
    "userAtom",
    "isAuthenticatedAtom",
    "loginAtom",
    "logoutAtom",
    "useFocusFirstHeading",
    "useOnlineStatus",
    "createApiClient",
    "createQueryClient",
    "OfflineBanner",
    "ErrorFallback",
    "InnerErrorFallback",
    "OuterErrorFallback",
    "AuthGate",
    "AppShell",
    "LoginLayout",
    "userSchema",
    "loginResponseSchema",
    "apiResponseSchema",
    "CLIENT_NETWORK_ERROR_CODE",
    "HTTP_OK",
    "HTTP_UNAUTHORIZED",
    "makeOkEnvelope",
    "makeUnauthorizedEnvelope",
    "AUTH_TOKEN_LS",
    "AUTH_USER_LS",
    "AUTH_EXPIRES_AT_LS",
    "synthesizeNetworkError",
    "ApiClientProvider",
    "useApiClient",
    "UserAvatar",
  ])("exports %s", (name) => {
    expect((shared as Record<string, unknown>)[name]).toBeDefined();
  });

  // `getAccessToken` MUST NOT leak through the barrel — only legitimate
  // consumers (services/axios.ts, _authed.tsx#beforeLoad) deep-import.
  it("does NOT re-export getAccessToken from the barrel", () => {
    expect((shared as Record<string, unknown>).getAccessToken).toBeUndefined();
  });
});
