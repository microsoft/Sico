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
