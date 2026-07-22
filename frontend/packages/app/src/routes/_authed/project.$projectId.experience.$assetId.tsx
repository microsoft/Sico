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
  AssetDetailPage,
  assetDetailQueryOptions,
  projectDetailQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { type JSX } from "react";
import { z } from "zod";

// Experience detail nests under its project (mirrors knowledge/deliverable), so
// the route carries `$projectId` for back-nav. Loader prefetches fire-and-forget
// to keep the skeleton up; `:projectId` is guarded by the layout parent.
export const Route = createFileRoute(
  "/_authed/project/$projectId/experience/$assetId",
)({
  beforeLoad: ({ params }) => {
    if (!z.coerce.number().int().positive().safeParse(params.assetId).success) {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- TanStack Router's `notFound()` is the documented control-flow signal
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      assetDetailQueryOptions(
        { id: Number(params.assetId), type: "experience" },
        context.apiClient,
      ),
    );
    void context.queryClient.prefetchQuery(
      projectDetailQueryOptions(Number(params.projectId), context.apiClient),
    );
  },
  component: ExperienceDetailRoute,
});

function ExperienceDetailRoute(): JSX.Element {
  const { assetId, projectId } = Route.useParams();
  return (
    <AssetDetailPage
      assetId={Number(assetId)}
      type="experience"
      projectId={Number(projectId)}
    />
  );
}
