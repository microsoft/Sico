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
