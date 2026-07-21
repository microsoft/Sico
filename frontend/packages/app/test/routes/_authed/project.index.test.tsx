import type { ComponentType } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

// `<Projects />` mounts react-query + axios; out of scope for this route
// smoke test which only verifies the route wires loader/head/component.
vi.mock("@sico/shared/features/projects/index.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@sico/shared/features/projects/index.ts")
    >();
  return {
    ...actual,
    Projects: vi.fn(() => <div data-testid="projects" />),
  };
});

// Narrow projection of the fields this smoke test reads off `Route.options`.
// TanStack Router's full option type is not callable in isolation, so we
// model only what we exercise here.
type RouteOptionsShape = {
  loader: (ctx: {
    context: { queryClient: unknown; apiClient: unknown };
  }) => unknown;
  head: () => { meta: { title: string }[] };
  component: ComponentType;
};

describe("/_authed/project route", () => {
  // Import the route module ONCE in beforeAll, not inside each test: the dynamic
  // import pulls in the whole `@sico/shared/features/projects` barrel, and under
  // the parallel CI/hook run (turbo fans out app + shared at once) that module
  // graph can take far longer than the 5s per-test timeout to resolve. Loading
  // it here keeps the cost out of any single test's clock.
  let Route: typeof import("../../../src/routes/_authed/project.index").Route;
  let projectsQueryOptions: typeof import("@sico/shared/features/projects/index.ts").projectsQueryOptions;

  beforeAll(async () => {
    ({ Route } = await import("../../../src/routes/_authed/project.index"));
    ({ projectsQueryOptions } =
      await import("@sico/shared/features/projects/index.ts"));
  });

  it("registers loader, head and component on the route", () => {
    const opts =
      Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;

    expect(opts.loader).toBeTypeOf("function");
    expect(opts.head).toBeTypeOf("function");
    expect(opts.component).toBeTypeOf("function");
  });

  it("loader calls queryClient.prefetchInfiniteQuery with projectsQueryOptions", () => {
    const prefetchInfiniteQuery = vi.fn().mockResolvedValue(undefined);
    const queryClient = { prefetchInfiniteQuery };
    const apiClient = {};

    const opts =
      Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;
    opts.loader({ context: { queryClient, apiClient } });

    expect(prefetchInfiniteQuery).toHaveBeenCalledTimes(1);
    const arg = prefetchInfiniteQuery.mock.calls[0]![0] as {
      queryKey: unknown;
    };
    expect(arg.queryKey).toEqual(
      projectsQueryOptions({}, apiClient as never).queryKey,
    );
  });

  it("loader returns synchronously (does not await the prefetch) so Suspense fallback is observable", () => {
    // Never-resolving prefetch — proves the loader is fire-and-forget.
    const prefetchInfiniteQuery = vi.fn(() => new Promise(() => {}));
    const queryClient = { prefetchInfiniteQuery };
    const apiClient = {};

    const opts =
      Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;
    expect(
      opts.loader({ context: { queryClient, apiClient } }),
    ).toBeUndefined();
  });

  it("head sets the document title to 'Projects · SICO'", () => {
    const opts =
      Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;
    const head = opts.head();
    expect(head.meta).toEqual([{ title: "Projects · SICO" }]);
  });

  it("component renders <Projects />", async () => {
    const { render, screen } = await import("@testing-library/react");
    const opts =
      Route.options as Partial<RouteOptionsShape> as RouteOptionsShape;
    const Component = opts.component;
    render(<Component />);
    screen.getByTestId("projects");
  });
});
