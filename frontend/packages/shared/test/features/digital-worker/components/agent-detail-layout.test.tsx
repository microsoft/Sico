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
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import axios from "axios";
import { type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentDetailLayout } from "@/features/digital-worker/components/agent-detail-layout";
import { fetchAgentDetail } from "@/features/digital-worker/services/agents";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/digital-worker/services/agents", async (orig) => ({
  ...(await orig<typeof import("@/features/digital-worker/services/agents")>()),
  fetchAgentDetail: vi.fn(),
}));

const mockFetchAgentDetail = vi.mocked(fetchAgentDetail);

type RenderResult = { navigate: (agentId: string) => Promise<void> };

// Mounts the layout under a real `/digital-worker/$agentId` route so the same
// boundary instance survives param changes (TanStack keeps the route component
// mounted across same-route navigation) — the condition the re-arm fix relies
// on. `navigate` drives a param switch the way the router does in production.
function renderLayout(
  children: ReactNode,
  actions?: ReactNode,
  initialAgentId = "7",
): RenderResult {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // `fetchAgentDetail` is mocked, so the client issues no request.
  const apiClient = axios.create({ baseURL: "/api/sico" });

  const rootRoute = createRootRoute();
  // Kept for any `/digital-worker` links in the tree; the Header's back link now
  // targets `/digital-worker/$agentId` (registered below).
  const dwRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker",
    component: () => <div>digital workers</div>,
  });
  const agentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker/$agentId",
    component: () => {
      const { agentId } = agentRoute.useParams();
      return (
        <AgentDetailLayout agentId={agentId} actions={actions}>
          {children}
        </AgentDetailLayout>
      );
    },
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([dwRoute, agentRoute]),
    history: createMemoryHistory({
      initialEntries: [`/digital-worker/${initialAgentId}`],
    }),
  });

  function Wrapper({ children: c }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>{c}</ApiClientProvider>
      </QueryClientProvider>
    );
  }

  render(
    <Wrapper>
      <RouterProvider router={router} />
    </Wrapper>,
  );

  return {
    navigate: (agentId: string) =>
      router.navigate({ to: "/digital-worker/$agentId", params: { agentId } }),
  };
}

describe("AgentDetailLayout", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders the Header once the agent detail resolves", async () => {
    mockFetchAgentDetail.mockResolvedValue({
      id: 7,
      name: "Ada",
      role: "Engineer",
      iconUri: undefined,
    });
    renderLayout(<div>routed content</div>);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
  });

  it("renders the routed children below the Header", async () => {
    mockFetchAgentDetail.mockResolvedValue({
      id: 7,
      name: "Ada",
      role: "Engineer",
      iconUri: undefined,
    });
    renderLayout(<div>routed content</div>);
    expect(await screen.findByText("routed content")).toBeInTheDocument();
  });

  it("mounts the actions slot in the Header", async () => {
    mockFetchAgentDetail.mockResolvedValue({
      id: 7,
      name: "Ada",
      role: "Engineer",
      iconUri: undefined,
    });
    renderLayout(
      <div>routed content</div>,
      <button type="button">Device</button>,
    );
    expect(
      await screen.findByRole("button", { name: "Device" }),
    ).toBeInTheDocument();
  });

  it("shows the error fallback when the agent detail query fails", async () => {
    mockFetchAgentDetail.mockRejectedValue(new Error("boom"));
    renderLayout(<div>routed content</div>);
    // The boundary takes over the whole panel: the ErrorView's retry surfaces.
    expect(
      await screen.findByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  // Regression: two non-numeric params both coerce to NaN, so keying the
  // boundary on `Number(agentId)` left it stuck (Object.is(NaN, NaN) === true →
  // no re-arm). Keying on the raw string param must re-arm on a bad → good
  // switch. Revert `agentId` to the numeric form and this test fails.
  it("re-arms the error boundary when the raw param changes between two NaN-coercing values", async () => {
    mockFetchAgentDetail.mockRejectedValueOnce(new Error("boom"));
    const { navigate } = renderLayout(
      <div>routed content</div>,
      undefined,
      "x",
    );
    expect(
      await screen.findByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();

    mockFetchAgentDetail.mockResolvedValue({
      id: 0,
      name: "Bo",
      role: "Analyst",
      iconUri: undefined,
    });
    await navigate("y");

    expect(await screen.findByText("Bo")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });
});
