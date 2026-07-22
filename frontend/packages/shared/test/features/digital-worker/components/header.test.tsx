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
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { type ReactElement, type ReactNode, Suspense } from "react";
import { describe, expect, it, vi } from "vitest";

import { Header } from "@/features/digital-worker/components/header";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@/features/digital-worker/services/agents", async (orig) => ({
  ...(await orig<typeof import("@/features/digital-worker/services/agents")>()),
  fetchAgentDetail: vi.fn().mockResolvedValue({
    id: 7,
    name: "Ada",
    role: "Engineer",
    iconUri: undefined,
    project: { id: 3, name: "Apollo" },
    operatorUsername: "ops@sico.ai",
  }),
}));

function renderHeader(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // `fetchAgentDetail` is mocked, so the client is never actually called —
  // a bare instance suffices and issues no request (cast-free per testing.md).
  const apiClient = axios.create({ baseURL: "/api/sico" });

  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <Suspense fallback={null}>
        <Header agentId={7} />
      </Suspense>
    ),
  });
  const router: AnyRouter = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  function Wrapper({ children }: { children: ReactNode }): ReactElement {
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

describe("Header", () => {
  it("renders the agent name and role", async () => {
    renderHeader();
    // Name and role render in sibling spans: `<span>Ada</span><span>, Engineer</span>`.
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText(", Engineer")).toBeInTheDocument();
  });

  it("opens an info popover with the agent's project and operator on click", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(
      await screen.findByRole("button", { name: "Agent details" }),
    );
    expect(await screen.findByText("Project")).toBeVisible();
    expect(screen.getByText("Apollo")).toBeVisible();
    expect(screen.getByText("Operator")).toBeVisible();
    expect(screen.getByText("ops@sico.ai")).toBeVisible();
  });
});
