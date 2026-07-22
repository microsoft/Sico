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
  type AssetSearch,
  assetSearchSchema,
  assetsInfiniteQueryOptions,
  projectDetailQueryOptions,
  ProjectWorkspace,
} from "@sico/shared/features/projects/index.ts";
import {
  createFileRoute,
  type SearchSchemaInput,
  stripSearchParams,
} from "@tanstack/react-router";
import type * as React from "react";

// The Knowledge category list (`/project/$projectId/knowledge`). Sibling of the
// knowledge detail route (`knowledge/$assetId`) under the `knowledge` Outlet, so
// the detail page is never wrapped by this list's chrome.
const DEFAULT_SEARCH = assetSearchSchema.parse({});

export const Route = createFileRoute("/_authed/project/$projectId/knowledge/")({
  validateSearch: (
    search: Record<string, unknown> & SearchSchemaInput,
  ): AssetSearch => assetSearchSchema.parse(search),
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loader: ({ context, params }) => {
    const projectId = Number(params.projectId);
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(projectId, context.apiClient),
    );
    void context.queryClient.prefetchInfiniteQuery(
      assetsInfiniteQueryOptions(projectId, "knowledge", context.apiClient),
    );
  },
  component: KnowledgeCategoryPage,
});

function KnowledgeCategoryPage(): React.JSX.Element {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectWorkspace
      projectId={Number(projectId)}
      category="knowledge"
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: (prev) => ({ ...prev, ...next }) });
      }}
    />
  );
}
