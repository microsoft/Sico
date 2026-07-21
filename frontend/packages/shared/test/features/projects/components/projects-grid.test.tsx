import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsGrid } from "../../../../src/features/projects/components/projects-grid";
import * as hookModule from "../../../../src/features/projects/hooks/use-projects-query";
import type { Project } from "../../../../src/features/projects/schemas/project";

vi.mock("../../../../src/features/projects/hooks/use-projects-query");

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

let ioInstances: {
  callback: IOCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[];

beforeEach(() => {
  ioInstances = [];
  class MockIO {
    callback: IOCallback;
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
    root = null;
    rootMargin = "";
    thresholds: readonly number[] = [];
    constructor(cb: IOCallback) {
      this.callback = cb;
      ioInstances.push({
        callback: cb,
        observe: this.observe,
        disconnect: this.disconnect,
      });
    }
  }
  Object.defineProperty(global, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIO,
  });
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: MockIO,
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

function makeProject(id: number): Project {
  return {
    id,
    name: `Project ${id}`,
    description: `Desc ${id}`,
    iconUrl: "",
    memberType: 3,
    agentInstances: [],
  };
}

function renderGrid(): ReturnType<typeof render> {
  const rootRoute = createRootRoute({ component: () => <ProjectsGrid /> });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

type HookResult = ReturnType<typeof hookModule.useProjectsInfiniteQuery>;

function mockHook(
  overrides: Partial<HookResult> & { pages?: Project[][] },
): void {
  const pages = overrides.pages ?? [];
  const base = {
    data: {
      pages: pages.map((items) => ({
        items,
        total: items.length,
        hasNext: false,
      })),
      pageParams: pages.map((_, idx) => idx + 1),
    },
    error: null,
    isError: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as Partial<HookResult> as HookResult;
  vi.mocked(hookModule.useProjectsInfiniteQuery).mockReturnValue({
    ...base,
    ...overrides,
  } as HookResult);
}

describe("<ProjectsGrid>", () => {
  it("renders one ProjectCard per item in the flattened pages", async () => {
    mockHook({ pages: [[makeProject(1), makeProject(2)], [makeProject(3)]] });
    renderGrid();
    expect(await screen.findAllByRole("link")).toHaveLength(3);
    screen.getByText("Project 1");
    screen.getByText("Project 3");
  });

  it("renders <EmptyState /> when there are zero items", async () => {
    mockHook({ pages: [[]] });
    renderGrid();
    await screen.findByText("Nothing here yet");
  });

  it("renders the Loading more Spinner while isFetchingNextPage is true", async () => {
    mockHook({
      pages: [[makeProject(1)]],
      hasNextPage: true,
      isFetchingNextPage: true,
    });
    renderGrid();
    await screen.findByLabelText("Loading more");
  });

  it("calls fetchNextPage when the sentinel intersects and hasNextPage is true", async () => {
    const fetchNextPage = vi.fn();
    mockHook({
      pages: [[makeProject(1)]],
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPage as Partial<
        HookResult["fetchNextPage"]
      > as HookResult["fetchNextPage"],
    });
    renderGrid();
    await screen.findByRole("link");
    expect(ioInstances.length).toBeGreaterThan(0);
    const io = ioInstances[ioInstances.length - 1]!;
    io.callback([
      {
        isIntersecting: true,
      } as Partial<IntersectionObserverEntry> as IntersectionObserverEntry,
    ]);
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
