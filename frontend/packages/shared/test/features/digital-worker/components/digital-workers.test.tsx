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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders, type AxiosInstance } from "axios";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { DigitalWorkers } from "@/features/digital-worker/components/digital-workers";
import { ApiClientProvider } from "@/services/api-client-context";

function axiosErrorWithStatus(status: number): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError(
    `HTTP ${String(status)}`,
    String(status),
    { headers },
    undefined,
    {
      status,
      statusText: "",
      headers: new AxiosHeaders(),
      config: { headers },
      data: null,
    },
  );
}

function axiosErrorNoResponse(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK");
}

// The suspense hook either returns data, throws a Promise (pending), or
// throws an Error (rejected). Tests configure the mock to do exactly
// one of those three.
const mockSuspense = vi.fn();
vi.mock("@/features/digital-worker/hooks/use-agents-query", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/digital-worker/hooks/use-agents-query")
  >("@/features/digital-worker/hooks/use-agents-query");
  return {
    ...actual,
    useSuspenseAgentsInfiniteQuery: () => mockSuspense(),
  };
});

function returnPages(pages: { items: unknown[]; hasNext: boolean }[]): void {
  mockSuspense.mockImplementation(() => ({
    data: { pages: pages.map((p) => ({ ...p, total: p.items.length })) },
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  }));
}

function throwError(error: unknown): void {
  mockSuspense.mockImplementation(() => {
    throw error;
  });
}

function throwPending(): void {
  // Suspense unwraps a thrown Promise to render the fallback.
  mockSuspense.mockImplementation(() => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense unwraps thrown Promises to render the fallback.
    throw new Promise(() => {});
  });
}

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <DigitalWorkers />,
  });
  const collabRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker/$agentId/collaboration",
    component: () => <div>collab</div>,
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, collabRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    // Stub client: the empty-state branch reads projects via a non-suspense
    // query; return an empty page so it resolves to "no project".
    const apiClient = {
      get: vi.fn().mockResolvedValue({
        data: {
          code: 0,
          msg: "",
          data: { projects: [], total: 0, hasNext: false },
        },
      }),
    } as unknown as AxiosInstance;
    return (
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
      </QueryClientProvider>
    );
  }

  render(
    <Wrapper>
      <RouterProvider router={router} />
    </Wrapper>,
  );
}

beforeEach(() => {
  mockSuspense.mockReset();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe("<DigitalWorkers>", () => {
  it("renders 12 skeletons while suspending", async () => {
    throwPending();
    renderPage();
    expect(
      await screen.findAllByTestId("digital-worker-card-skeleton"),
    ).toHaveLength(12);
  });

  it("renders cards in backend order (no client re-sort)", async () => {
    // `selectDedupedAgents` preserves backend order — it does NOT re-sort by
    // `updatedAt` (a higher updatedAt on a later page must not jump ahead).
    returnPages([
      {
        items: [
          { id: 1, name: "First", updatedAt: 1704067200000 },
          { id: 2, name: "Second", updatedAt: 1735689600000 },
        ],
        hasNext: false,
      },
    ]);
    renderPage();
    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toContain("First");
  });

  it("renders empty state when items array is empty", async () => {
    returnPages([{ items: [], hasNext: false }]);
    renderPage();
    await screen.findByText("Your crew is one hire away");
  });

  it("hides inactive DWs behind a toggle that reveals them on click", async () => {
    returnPages([
      {
        items: [
          { id: 1, name: "ActiveOne", status: 3 },
          { id: 2, name: "GoneOne", status: 4 },
        ],
        hasNext: false,
      },
    ]);
    renderPage();
    // Active shows immediately; inactive is hidden until the toggle is used.
    await screen.findByText("ActiveOne");
    expect(screen.queryByText("GoneOne")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", {
      name: /show 1 inactive digital workers/i,
    });
    toggle.click();
    await screen.findByText("GoneOne");
  });

  it("renders network copy for AxiosError without response", async () => {
    throwError(axiosErrorNoResponse());
    renderPage();
    await screen.findByText("Check your connection and try again.");
  });

  it("renders network copy for raw AbortError (non-Axios)", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throwError(err);
    renderPage();
    await screen.findByText("Check your connection and try again.");
  });

  it("renders network copy for raw TypeError (fetch Failed to fetch)", async () => {
    throwError(new TypeError("Failed to fetch"));
    renderPage();
    await screen.findByText("Check your connection and try again.");
  });

  it("renders server copy for AxiosError 5xx (500)", async () => {
    throwError(axiosErrorWithStatus(500));
    renderPage();
    await screen.findByText(
      "Something went wrong on our end. Try again in a moment.",
    );
  });

  it("renders server copy for AxiosError 502", async () => {
    throwError(axiosErrorWithStatus(502));
    renderPage();
    await screen.findByText(
      "Something went wrong on our end. Try again in a moment.",
    );
  });

  it("renders unknown-bucket title for AxiosError 4xx (contract bug)", async () => {
    throwError(axiosErrorWithStatus(404));
    renderPage();
    await screen.findByText("Something went wrong on this page. Try again.");
  });

  it("renders schema-bucket title for ZodError (schema mismatch)", async () => {
    const zodErr = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["name"],
        message: "Expected string",
        input: 123,
      },
    ]);
    throwError(zodErr);
    renderPage();
    await screen.findByText(
      "We received unexpected data. Try refreshing the page.",
    );
  });

  it("renders unknown-bucket title for plain Error (envelope missing)", async () => {
    throwError(new Error("Envelope missing"));
    renderPage();
    await screen.findByText("Something went wrong on this page. Try again.");
  });
});
