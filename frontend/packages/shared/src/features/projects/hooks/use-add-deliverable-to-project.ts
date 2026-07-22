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
import {
  type AddDeliverableInput,
  addDeliverableToProject,
} from "../services/deliverable";

// "Add to project" from a deliverable preview — publishes the file into the
// project's assets. The success toast + View navigation live in the button (it
// owns the projectId for the View link); this hook owns the cache side effect:
// on success it invalidates the project's asset lists (`["projects","assets",
// projectId]`) so the freshly-added deliverable shows when the View link lands
// (the deliverable list has a 30s staleTime and isn't polled, so without this
// the new row is missing). Mirrors `useAddKnowledgeMutation`.
export function useAddDeliverableToProject(): UseMutationResult<
  void,
  Error,
  AddDeliverableInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDeliverableInput): Promise<void> =>
      addDeliverableToProject(apiClient, input),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", "assets", input.projectId],
      });
    },
  });
}
