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
