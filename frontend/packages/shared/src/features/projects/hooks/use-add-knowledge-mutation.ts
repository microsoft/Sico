import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";

import { useApiClient } from "../../../services/api-client-context";
import { DocumentTypeSchema } from "../schemas/asset";
import { registerDocument, uploadAsset } from "../services/asset-mutations";

const { FILE, LINK } = DocumentTypeSchema.enum;

// A file is a two-step register: upload the blob, then register the document
// that references the returned `assetId`. A link skips the upload and registers
// directly by `linkUrl`. Both carry the selected `tagIds`. File validation
// (type/size/count) is the DIALOG's job, not here.
export type AddKnowledgeInput = {
  files: File[];
  links: string[];
  tagIds: number[];
};
export type AddKnowledgeResult = { succeeded: string[]; failed: string[] };

// Bucket settled outcomes into succeeded/failed by a parallel label list (file
// names then link urls, in dispatch order).
function bucketByOutcome(
  settled: PromiseSettledResult<unknown>[],
  labels: string[],
): AddKnowledgeResult {
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const [index, outcome] of settled.entries()) {
    const label = labels[index] ?? "";
    (outcome.status === "fulfilled" ? succeeded : failed).push(label);
  }
  return { succeeded, failed };
}

// Batch knowledge upload. Files register as FILE, links register as LINK, both
// carry `tagIds`. Every item runs in PARALLEL and one rejection must NOT abort
// the batch (M-3), so we drive with `Promise.allSettled` and bucket the item
// LABELS (file name / link url) into succeeded/failed. The dialog decides the
// mixed-result copy — this hook only reports the outcome.
export function useAddKnowledgeMutation(
  projectId: number,
): UseMutationResult<AddKnowledgeResult, Error, AddKnowledgeInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      files,
      links,
      tagIds,
    }: AddKnowledgeInput): Promise<AddKnowledgeResult> => {
      const settled = await Promise.allSettled([
        ...files.map(async (file) => {
          const uploaded = await uploadAsset(apiClient, projectId, file);
          await registerDocument(apiClient, {
            projectId,
            assetId: uploaded.id,
            documentType: FILE,
            tagIds,
          });
        }),
        ...links.map((linkUrl) =>
          registerDocument(apiClient, {
            projectId,
            linkUrl,
            documentType: LINK,
            tagIds,
          }),
        ),
      ]);
      const labels = [...files.map((file) => file.name), ...links];
      return bucketByOutcome(settled, labels);
    },
    onSuccess: (result) => {
      if (result.succeeded.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: ["projects", "assets", projectId],
        });
      }
    },
  });
}
