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
