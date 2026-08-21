import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { type ReactNode } from "react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Projects } from "@/features/projects/components/projects";
import { useProjectsInfiniteQuery } from "@/features/projects/hooks/use-projects-query";
import * as service from "@/features/projects/services/projects";
import { ApiClientProvider } from "@/services/api-client-context";

// `<Projects>` reads via `useSuspenseInfiniteQuery`, which on failure
// throws to the nearest ErrorBoundary AND keeps the query in error
// state. Without `<QueryErrorResetBoundary>`, "Try again" remounts the
// subtree but the cache still serves the failure → the hook re-throws
// and the user is stuck in the error view. The wiring under test:
// `QueryErrorResetBoundary → ErrorBoundary.onReset` clears both, so
// the refetch is allowed to fire.
vi.mock("@/features/projects/services/projects");

// Replace the grid with a thin stub that still triggers suspense (so
// the boundary path is exercised) but skips rendering `<ProjectCard>`
// — `<ProjectCard>` mounts a TanStack `<Link>` which needs a Router
// context this unit test does not provide.
vi.mock("@/features/projects/components/projects-grid", () => ({
  ProjectsGrid: function ProjectsGridStub(): React.JSX.Element {
    useProjectsInfiniteQuery();
    return <div data-testid="projects-grid-recovered" />;
  },
}));

function makeWrapper() {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.mocked(service.fetchProjects).mockReset();
});

describe("<Projects> error → reset → success recovery", () => {
  it("re-invokes fetchProjects after 'Try again' so the failed query is no longer cached", async () => {
    // Suppress React's error-boundary noise for the deliberate throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(service.fetchProjects)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        items: [],
        total: 0,
        hasNext: false,
      });

    const Wrapper = makeWrapper();
    render(<Projects />, { wrapper: Wrapper });

    // First render: query rejects → ErrorView shown.
    const tryAgain = await screen.findByRole("button", { name: "Try again" });

    // The fix: clicking "Try again" must clear the cached error so the
    // refetched query can resolve and the grid can mount again.
    await userEvent.click(tryAgain);

    await waitFor(
      () => {
        expect(service.fetchProjects).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
    await waitFor(() => {
      screen.getByTestId("projects-grid-recovered");
    });

    spy.mockRestore();
  });
});
