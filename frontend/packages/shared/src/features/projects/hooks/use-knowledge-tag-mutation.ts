import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import type { Paged } from "../../../schemas/paginated";
import { useApiClient } from "../../../services/api-client-context";
import type { KnowledgeTag } from "../schemas/knowledge-tag";
import {
  createKnowledgeTag,
  deleteKnowledgeTag,
  editKnowledgeTag,
} from "../services/knowledge-tags";

type CreateVars = { projectId: number; name: string; description: string };
type EditVars = { id: number; name: string; description: string };

export type UseKnowledgeTagMutationResult = {
  create: UseMutationResult<number, Error, CreateVars>;
  edit: UseMutationResult<number, Error, EditVars>;
  remove: UseMutationResult<void, Error, number>;
};

// Fans out the three knowledge-tag writes; each invalidates the project's
// knowledge-tags list so the table re-reads canonical server state.
export function useKnowledgeTagMutation(
  projectId: number,
): UseKnowledgeTagMutationResult {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({
      queryKey: ["projects", "knowledge-tags", projectId],
    });

  const create = useMutation({
    mutationFn: (vars: CreateVars) => createKnowledgeTag(apiClient, vars),
    // Insert into the cache before invalidating so the new tag's chip shows
    // immediately; the placeholder server fields are overwritten by the refetch.
    onSuccess: (newId, vars) => {
      const key = ["projects", "knowledge-tags", projectId];
      queryClient.setQueryData<Paged<KnowledgeTag>>(key, (prev) =>
        prev
          ? {
              ...prev,
              items: [
                ...prev.items,
                {
                  id: newId,
                  projectId,
                  name: vars.name,
                  description: vars.description,
                  creatorUsername: "",
                  createdAt: 0,
                  updatedAt: 0,
                },
              ],
              total: prev.total + 1,
            }
          : prev,
      );
      return invalidate();
    },
  });
  const edit = useMutation({
    mutationFn: (vars: EditVars) => editKnowledgeTag(apiClient, vars),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteKnowledgeTag(apiClient, id),
    onSuccess: invalidate,
  });

  return { create, edit, remove };
}
