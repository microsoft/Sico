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

import { AGENTS_QUERY_KEY_PREFIX } from "./use-agents-query";
import { useApiClient } from "../../../services/api-client-context";
import {
  createAgentInstance,
  type CreateAgentInstanceInput,
  type CreatedAgentInstance,
} from "../services/agents";

// Invalidate `["agents", "list"]` (the /digital-worker grid) AND `["projects"]`
// (the project list cards' avatar group + the /project/:id detail DW list) so a
// newly-created instance shows up immediately on every surface — the project
// queries have a 30s staleTime + no focus refetch, so without this the project
// pages keep stale data until a hard reload.
export function useCreateAgentInstanceMutation(): UseMutationResult<
  CreatedAgentInstance,
  Error,
  CreateAgentInstanceInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInstanceInput) =>
      createAgentInstance(apiClient, input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: AGENTS_QUERY_KEY_PREFIX,
          exact: false,
        }),
        queryClient.invalidateQueries({
          queryKey: ["projects"],
          exact: false,
        }),
      ]),
  });
}
