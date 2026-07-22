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

import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import type * as React from "react";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { ProjectWorkspaceContent } from "./project-workspace-content";
import { ProjectWorkspaceSkeleton } from "./project-workspace-skeleton";
import { ErrorView } from "../../../components/error-view";
import type { AssetSearch } from "../schemas/asset-search";
import type { AssetCategory } from "../types";

export type ProjectWorkspaceProps = {
  projectId: number;
  /** The active category, from the route path (`/project/$id/knowledge` etc.). */
  category: AssetCategory;
  search: AssetSearch;
  onSearchChange: (next: Partial<AssetSearch>) => void;
};

/**
 * Feature root for `/project/$projectId[/{category}]` — the per-project
 * workspace shell. Thin by design: it owns only the suspense + error wiring so
 * the suspending `<ProjectWorkspaceContent>` (which fetches the project detail +
 * knowledge tags) has a fallback and its throws have a boundary.
 *
 * `useQueryErrorResetBoundary` is critical: without piping its `reset` into
 * `ErrorBoundary.onReset`, "Try again" remounts the subtree but the failed
 * query stays in error state, so the suspense hook re-throws on remount and
 * the user is stuck.
 */
export function ProjectWorkspace({
  projectId,
  category,
  search,
  onSearchChange,
}: ProjectWorkspaceProps): React.JSX.Element {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary
      FallbackComponent={ErrorView}
      onReset={reset}
      resetKeys={[projectId]}
    >
      <Suspense fallback={<ProjectWorkspaceSkeleton />}>
        <ProjectWorkspaceContent
          projectId={projectId}
          category={category}
          search={search}
          onSearchChange={onSearchChange}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
