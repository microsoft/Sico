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

import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "../../../services/api-client-context";
import { createProject } from "../services/projects";

type CreateProjectVars = {
  name: string;
  description?: string;
  // Cover URL (`uri` from a prior asset upload). Forwarded to `createProject`
  // as the project's `iconUri`.
  iconUri?: string;
};

// Invalidate the `["projects"]` prefix so the new project refreshes the list and
// any detail view without a manual reload (matches the DW-create hook's key).
export function useCreateProjectMutation(): UseMutationResult<
  number,
  Error,
  CreateProjectVars
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: CreateProjectVars) => createProject(apiClient, vars),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["projects"],
        exact: false,
      }),
  });
}
