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

import { buildLoginRedirect, createApiClient } from "@sico/shared";
import { type AxiosInstance } from "axios";

import { router } from "@/router";
import { backendProfile } from "@/services/backend-profile";
import { store } from "@/store";

// `router.state.location.pathname` is read inside the closure so it
// captures the URL at the moment the 401 fires. `baseURL` comes from the
// build-time backend profile (sico → /api/sico, dwp → /api/dwp).
export const api: AxiosInstance = createApiClient({
  baseURL: backendProfile.baseURL,
  store,
  onUnauthorized: (): void => {
    void router.navigate(buildLoginRedirect(router.state.location.pathname));
  },
});
