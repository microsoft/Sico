import {
  type AssetSearch,
  assetSearchSchema,
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

import { Route } from "../../../src/routes/_authed/project.$projectId.index";

// `<ProjectWorkspace>` mounts react-query + axios; out of scope for this route
// test which only verifies the route wires validateSearch/loader/component.
// Keep the REAL assetSearchSchema + projectDetailQueryOptions — only the
// component is stubbed.
vi.mock("@sico/shared/features/projects/index.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@sico/shared/features/projects/index.ts")
    >();
  return {
    ...actual,
    ProjectWorkspace: vi.fn(() => <div data-testid="project-workspace" />),
  };
});

// Narrow projection of the fields these tests read off `Route.options`.
// TanStack Router's full option type is not callable in isolation, so we
// model only what we exercise here.
type RouteOptionsShape = {
  validateSearch: (s: Record<string, unknown>) => AssetSearch;
  loader: (ctx: {
    context: { queryClient: unknown; apiClient: unknown };
    params: { projectId: string };
  }) => unknown;
  component: ComponentType;
};

const options = (): RouteOptionsShape =>
  Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;

describe("/_authed/project/$projectId/", () => {
  it("validateSearch parses {} to the defaults", () => {
    expect(options().validateSearch({})).toEqual({
      sort: "desc",
      q: "",
    });
  });

  it("loader fire-and-forget prefetches the project detail, knowledge tags, and first asset page", () => {
    const prefetchQuery = vi.fn().mockResolvedValue(undefined);
    const prefetchInfiniteQuery = vi.fn().mockResolvedValue(undefined);
    const queryClient = { prefetchQuery, prefetchInfiniteQuery };
    const apiClient = {};

    options().loader({
      context: { queryClient, apiClient },
      params: { projectId: "42" },
    });

    // Project detail + the drawer's knowledge-tags prefetch in parallel so the
    // drawer resolves from cache behind the single skeleton instead of a
    // post-mount client waterfall. The drawer's Sandbox + Team sections read
    // `project.sandboxes` / `project.projectMembers` inline from the detail
    // payload, so no separate devices/members prefetch is needed here.
    expect(prefetchQuery).toHaveBeenCalledTimes(2);
    const prefetchedKeys = prefetchQuery.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown }).queryKey,
    );
    expect(prefetchedKeys).toContainEqual(
      projectDetailQueryOptions(42, apiClient as never).queryKey,
    );
    expect(prefetchedKeys).toContainEqual(
      knowledgeTagsQueryOptions(42, apiClient as never).queryKey,
    );
    // The ALL category's first page is prefetched in parallel so the suspense
    // rows resolve from cache instead of fetch-on-render.
    expect(prefetchInfiniteQuery).toHaveBeenCalledTimes(1);
  });

  it("loader returns synchronously (does not await the prefetch)", () => {
    // Never-resolving prefetches — proves the loader is fire-and-forget so the
    // in-feature Suspense skeleton stays observable.
    const prefetchQuery = vi.fn(() => new Promise(() => {}));
    const prefetchInfiniteQuery = vi.fn(() => new Promise(() => {}));
    const queryClient = { prefetchQuery, prefetchInfiniteQuery };
    const apiClient = {};

    expect(
      options().loader({
        context: { queryClient, apiClient },
        params: { projectId: "42" },
      }),
    ).toBeUndefined();
  });

  it("component renders <ProjectWorkspace>", async () => {
    // The component calls strict Route.useParams/useSearch/useNavigate, which
    // require a router context. File routes are path-bound, so we mirror the
    // route's real options (validateSearch/loader/component) into a memory
    // tree; the matched params/search flow into the file Route's strict hooks.
    const opts = options();
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/project/$projectId/",
      validateSearch: assetSearchSchema,
      loader: opts.loader as never,
      component: opts.component as never,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({
        initialEntries: ["/project/42"],
      }),
      context: { queryClient: new QueryClient(), apiClient: {} },
    });

    render(<RouterProvider router={router as never} />);

    expect(await screen.findByTestId("project-workspace")).toBeInTheDocument();
  });
});
