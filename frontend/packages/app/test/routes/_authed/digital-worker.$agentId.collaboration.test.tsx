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

import { ApiClientProvider } from "@sico/shared";
import { persistLoginPayload } from "@sico/shared/utils/auth-storage.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  type RegisteredRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../src/routeTree.gen";
import { clearAuthStorage } from "../../_helpers/clear-auth-storage";

// Chat is now addressed by conversation: `/collaboration/$conversationId`
// renders the chat, while a BARE `/collaboration` (no conversation) redirects to
// the DW home (the index). This suite mocks `fetchHistory` + the agent detail
// the Header reads.
const { fetchHistoryMock, fetchAgentDetailMock } = vi.hoisted(() => ({
  fetchHistoryMock: vi.fn(),
  fetchAgentDetailMock: vi.fn(),
}));

vi.mock("@sico/shared/features/sidebar/components/sidebar.tsx", () => ({
  Sidebar: () => null,
}));

vi.mock("@sico/shared/features/chat/services/history.ts", () => ({
  fetchHistory: fetchHistoryMock,
}));

vi.mock("@sico/shared/features/digital-worker/services/agents.ts", () => ({
  fetchAgentDetail: fetchAgentDetailMock,
  fetchAgents: vi.fn(),
}));

function renderAt(path: string): { router: RegisteredRouter } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const apiClient = {} as AxiosInstance;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, apiClient },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { router: router as unknown as RegisteredRouter };
}

beforeEach(() => {
  persistLoginPayload({
    tokenInfo: {
      accessToken: "tok",
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    },
    user: { id: 1, email: "user@example.com", roles: [] },
  });
  fetchAgentDetailMock.mockResolvedValue({
    id: 7,
    name: "Arena",
    role: "Tester",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  clearAuthStorage();
});

describe("/_authed/digital-worker/$agentId/collaboration", () => {
  it("redirects a bare /collaboration (no conversation) to the DW home", async () => {
    fetchHistoryMock.mockResolvedValue({ items: [], hasNext: false });
    const { router } = renderAt("/digital-worker/7/collaboration");
    // The Header renders the agent name once detail resolves.
    await screen.findByText("Arena");
    // Bare /collaboration has no conversation to render → redirect to the index.
    expect(router.state.location.pathname).toBe("/digital-worker/7");
  });

  it("renders the chat at /collaboration/$conversationId", async () => {
    fetchHistoryMock.mockResolvedValue({
      items: [
        {
          id: "1",
          author: "human",
          content: [{ partId: "1:0", type: "text", text: "hi" }],
        },
      ],
      hasNext: false,
    });
    const { router } = renderAt("/digital-worker/7/collaboration/55");
    await screen.findByText("Arena");
    expect(router.state.location.pathname).toBe(
      "/digital-worker/7/collaboration/55",
    );
  });

  it("keeps the Header and Composer on a history-fetch failure (non-suspense, in-place toast)", async () => {
    // History fetches non-suspense: a failure toasts in-place and never throws,
    // so NOTHING is replaced — the Header (agent name) AND the Composer both stay
    // mounted. This is the core decouple guarantee: a history error can't blank
    // the panel or hide the user's just-sent message + input.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    fetchHistoryMock.mockRejectedValue(new Error("history boom"));
    renderAt("/digital-worker/7/collaboration/55");
    expect(await screen.findByText("Arena")).toBeInTheDocument();
    // The composer survives — the user can still type/retry after the failure.
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});
