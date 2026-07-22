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

import { toast } from "@sico/ui";
import {
  useMutation,
  type UseMutationResult,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { SKILLS_QUERY_KEY_PREFIX } from "./use-skills-query";
import { useApiClient } from "../../../services/api-client-context";
import { type SkillItem, SkillStatusSchema } from "../schemas/skill";
import { uploadSkillAsset } from "../services/asset-upload";
import {
  createSkill,
  deleteSkill,
  type SkillUpdateResult,
  updateSkill,
  type UpdateSkillInput,
} from "../services/skills";

type CreateSkillVariables = {
  agentId: string;
  assetId: number;
  projectId?: number;
};

export function useCreateSkillMutation(): UseMutationResult<
  SkillItem,
  Error,
  CreateSkillVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillVariables) => createSkill(apiClient, input),
    // Adding a skill collapses the list back to page 1: reset drops every cached
    // page and refetches only the first (legacy refresh-on-add behavior).
    onSuccess: () =>
      queryClient.resetQueries({ queryKey: [SKILLS_QUERY_KEY_PREFIX] }),
  });
}

export function useUpdateSkillMutation(): UseMutationResult<
  SkillUpdateResult,
  Error,
  UpdateSkillInput
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input: UpdateSkillInput) => updateSkill(apiClient, input),
  });
}

export function useDeleteSkillMutation(): UseMutationResult<
  void,
  Error,
  number
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSkill(apiClient, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [SKILLS_QUERY_KEY_PREFIX] }),
  });
}

export function useUploadSkillAssetMutation(): UseMutationResult<
  number,
  Error,
  File
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (file: File) => uploadSkillAsset(apiClient, file),
  });
}

// Create-mode upload (legacy UploadSkillsDialog `uploadSkillFiles`): uploads
// each file to the asset store, then creates a skill referencing its assetId.
// Returns true when the skill is still uploading, false when ready, or null when
// the file failed (swallowed so a partial batch still surfaces success).
async function uploadOneSkill(
  apiClient: ReturnType<typeof useApiClient>,
  agentId: string,
  file: File,
): Promise<boolean | null> {
  try {
    const assetId = await uploadSkillAsset(apiClient, file);
    const skill = await createSkill(apiClient, { agentId, assetId });
    return skill.status === SkillStatusSchema.enum.UPLOADING;
  } catch {
    return null;
  }
}

// Create-mode upload hook: runs every picked file through uploadOneSkill, then
// toasts/invalidates based on the batch outcome. Returns whether any file landed
// so the dialog can close only on success.
export function useUploadSkills(agentId: string): {
  uploadFiles: (files: File[]) => Promise<boolean>;
  uploading: boolean;
} {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { mutateAsync, isPending } = useMutation({
    mutationFn: async (
      files: File[],
    ): Promise<{ successCount: number; anyUploading: boolean }> => {
      const results = await Promise.all(
        files.map((file) => uploadOneSkill(apiClient, agentId, file)),
      );
      const succeeded = results.filter((r): r is boolean => r !== null);
      return {
        successCount: succeeded.length,
        anyUploading: succeeded.some(Boolean),
      };
    },
    onSuccess: ({ successCount }) => {
      if (successCount > 0) {
        // Reset (not invalidate) so the list collapses to a freshly fetched
        // first page instead of refetching every page scrolled so far.
        void queryClient.resetQueries({
          queryKey: [SKILLS_QUERY_KEY_PREFIX],
        });
      }
    },
  });

  const uploadFiles = useCallback(
    async (files: File[]): Promise<boolean> => {
      if (files.length === 0 || !agentId) {
        return false;
      }
      const { successCount, anyUploading } = await mutateAsync(files);
      if (successCount > 0) {
        toast.success(
          anyUploading ? "Skills are uploading." : "Skills added successfully.",
        );
        return true;
      }
      toast.error("Failed to add skills.");
      return false;
    },
    [agentId, mutateAsync],
  );

  return { uploadFiles, uploading: isPending };
}
