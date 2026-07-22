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

import { describe, expect, it } from "vitest";

import {
  assetDetailQueryOptions,
  assetSearchSchema,
  assetsInfiniteQueryOptions,
  knowledgeTagsQueryOptions,
  projectDetailQueryOptions,
  Projects,
  projectsQueryOptions,
  resolveAssetDetailGuard,
  useAddKnowledgeMutation,
  useAssetDetailQuery,
  useAssetMutation,
  useKnowledgeTagMutation,
  useKnowledgeTagsQuery,
  useProjectDetailQuery,
  useProjectMutation,
  useProjectsInfiniteQuery,
} from "../../../src/features/projects";

describe("projects barrel", () => {
  it("exposes Projects and projectsQueryOptions", () => {
    expect(Projects).toBeTypeOf("function");
    expect(projectsQueryOptions).toBeTypeOf("function");
    expect(useProjectsInfiniteQuery).toBeTypeOf("function");
  });

  it("exposes the detail / assets / knowledge-tags query factories + hooks", () => {
    expect(projectDetailQueryOptions).toBeTypeOf("function");
    expect(useProjectDetailQuery).toBeTypeOf("function");
    expect(useProjectMutation).toBeTypeOf("function");
    expect(assetsInfiniteQueryOptions).toBeTypeOf("function");
    expect(assetDetailQueryOptions).toBeTypeOf("function");
    expect(useAssetDetailQuery).toBeTypeOf("function");
    expect(knowledgeTagsQueryOptions).toBeTypeOf("function");
    expect(useKnowledgeTagsQuery).toBeTypeOf("function");
    expect(useKnowledgeTagMutation).toBeTypeOf("function");
    expect(useAddKnowledgeMutation).toBeTypeOf("function");
    expect(useAssetMutation).toBeTypeOf("function");
  });

  it("exposes the route-facing pure helper + search schema", () => {
    expect(resolveAssetDetailGuard).toBeTypeOf("function");
    expect(assetSearchSchema).toBeDefined();
  });
});
