import {
  knowledgeTagsQueryOptions,
  projectDetailQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import { Route } from "../../../src/routes/_authed/project.$projectId.knowledge-tags";

// Stub the component, keep the real `knowledgeTagsQueryOptions` so the loader test
// can assert its key.
vi.mock("@sico/shared/features/projects/index.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@sico/shared/features/projects/index.ts")
    >();
  return {
    ...actual,
    KnowledgeTags: vi.fn(() => <div data-testid="knowledge-tags" />),
  };
});

type RouteOptionsShape = {
  loader: (ctx: {
    context: { queryClient: unknown; apiClient: unknown };
    params: { projectId: string };
  }) => unknown;
  component: ComponentType;
};

const options = (): RouteOptionsShape =>
  Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;

describe("/_authed/project/$projectId/knowledge-tags", () => {
  it("loader fire-and-forget prefetches the knowledgeTags + projectDetail queries", () => {
    const prefetchQuery = vi.fn().mockResolvedValue(undefined);
    const queryClient = { prefetchQuery };
    const apiClient = {};

    options().loader({
      context: { queryClient, apiClient },
      params: { projectId: "42" },
    });

    expect(prefetchQuery).toHaveBeenCalledTimes(2);
    const prefetchedKeys = prefetchQuery.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown }).queryKey,
    );
    expect(prefetchedKeys).toContainEqual(
      knowledgeTagsQueryOptions(42, apiClient as never).queryKey,
    );
    expect(prefetchedKeys).toContainEqual(
      projectDetailQueryOptions(42, apiClient as never).queryKey,
    );
  });

  it("loader returns synchronously (does not await the prefetch)", () => {
    const prefetchQuery = vi.fn(() => new Promise(() => {}));
    const queryClient = { prefetchQuery };
    const apiClient = {};

    expect(
      options().loader({
        context: { queryClient, apiClient },
        params: { projectId: "42" },
      }),
    ).toBeUndefined();
  });

  it("component mounts <KnowledgeTags>", async () => {
    const opts = options();
    const rootRoute = createRootRoute();
    const knowledgeTagsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/project/$projectId/knowledge-tags",
      loader: opts.loader as never,
      component: opts.component as never,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([knowledgeTagsRoute]),
      history: createMemoryHistory({
        initialEntries: ["/project/42/knowledge-tags"],
      }),
      context: { queryClient: new QueryClient(), apiClient: {} },
    });

    render(<RouterProvider router={router as never} />);

    expect(await screen.findByTestId("knowledge-tags")).toBeInTheDocument();
  });
});
