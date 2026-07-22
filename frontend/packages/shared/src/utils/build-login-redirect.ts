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
