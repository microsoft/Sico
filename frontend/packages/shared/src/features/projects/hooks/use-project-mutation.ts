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
import type { ProjectDetail } from "../schemas/project";
import { updateProject } from "../services/projects";

// The caller passes a PARTIAL edit and never owns `operatorAdmins`: the hook
// always sends the FULL operator set so a `{ name }`-only edit can't blank the
// operators (data-loss guard, §6 dec 6). An explicit `operatorAdmins` (the
// add/remove flows compute the next full set) overrides the cached injection.
type ProjectMutationVars = {
  name?: string;
  description?: string;
  iconUri?: string;
  operatorAdmins?: string[];
};

export function useProjectMutation(
  id: number,
): UseMutationResult<number, Error, ProjectMutationVars> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: ProjectMutationVars) => {
      const cached = queryClient.getQueryData<ProjectDetail>([
        "projects",
        "detail",
        id,
      ]);
      const operatorAdmins =
        vars.operatorAdmins ?? cached?.operatorAdmins ?? [];
      return updateProject(apiClient, { ...vars, id, operatorAdmins });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["projects", "detail", id],
      }),
  });
}
