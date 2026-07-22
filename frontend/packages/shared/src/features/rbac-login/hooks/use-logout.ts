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

// Orchestrates server logout → client cleanup → navigate. Server failure
// is non-blocking: client cleanup + navigate still run via `onSettled`.
import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { logoutAtom } from "../../../atoms/auth-atom";
import { useApiClient } from "../../../services/api-client-context";
import { logoutApi } from "../services/logout-api";

export function useLogout(): UseMutationResult<void, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const logout = useSetAtom(logoutAtom);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => logoutApi(apiClient),
    onSettled: async () => {
      // Navigate first so Sidebar/useAgentsQuery unmount before auth +
      // cache are wiped — otherwise the still-mounted query refetches
      // against a cleared token → spurious 401 flash. try/finally so
      // client cleanup runs even if navigation throws.
      try {
        await navigate({ to: "/login", replace: true });
      } finally {
        logout();
        queryClient.clear();
      }
    },
  });
}
