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

export { AssetDetail } from "./components/asset-detail";
export { AssetDetailContent } from "./components/asset-detail-content";
export {
  AssetDetailPage,
  type AssetDetailPageProps,
} from "./components/asset-detail-page";
export { AssetDetailSkeleton } from "./components/asset-detail-skeleton";
export { Projects } from "./components/projects";
export { createProjectDialogOpenAtom } from "./atoms/create-project-dialog-atom";
export {
  CreateProjectDialog,
  type CreateProjectDialogProps,
} from "./components/create-project-dialog";
export { useCreateProjectMutation } from "./hooks/use-create-project-mutation";
export {
  ProjectWorkspace,
  type ProjectWorkspaceProps,
} from "./components/project-workspace";
export {
  KnowledgeTags,
  type KnowledgeTagsProps,
} from "./components/knowledge-tags";
export {
  useAddKnowledgeMutation,
  type AddKnowledgeResult,
} from "./hooks/use-add-knowledge-mutation";
export {
  assetDetailQueryOptions,
  resolveAssetDetailGuard,
  useAssetDetailQuery,
} from "./hooks/use-asset-detail-query";
export {
  type UseAssetMutationResult,
  useAssetMutation,
} from "./hooks/use-asset-mutation";
export { assetsInfiniteQueryOptions } from "./hooks/use-assets-query";
export { useProjectMutation } from "./hooks/use-project-mutation";
export {
  projectDetailQueryOptions,
  useProjectDetailQuery,
} from "./hooks/use-project-query";
export {
  projectsQueryOptions,
  useProjectsInfiniteQuery,
} from "./hooks/use-projects-query";
export {
  type UseKnowledgeTagMutationResult,
  useKnowledgeTagMutation,
} from "./hooks/use-knowledge-tag-mutation";
export {
  knowledgeTagsQueryOptions,
  useKnowledgeTagsQuery,
} from "./hooks/use-knowledge-tags-query";
export { type AssetSearch, assetSearchSchema } from "./schemas/asset-search";
export type { AssetCategory } from "./types";
