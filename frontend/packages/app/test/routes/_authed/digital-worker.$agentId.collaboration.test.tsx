import { ApiClientProvider } from "@sico/shared";
import { AgentStatusSchema } from "@sico/shared/features/digital-worker/index.ts";
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
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../src/routeTree.gen";
import { clearAuthStorage } from "../../_helpers/clear-auth-storage";
import { seedOrganizationContext } from "../../_helpers/organization-context";

// Chat is now addressed by conversation: `/collaboration/$conversationId`
// renders the chat, while a BARE `/collaboration` (no conversation) redirects to
// the DW home (the index). This suite mocks `fetchHistory` + the agent detail
// the Header reads.
const {
  fetchHistoryMock,
  fetchAgentDetailMock,
  fetchAgentsMock,
  getConversationMock,
} = vi.hoisted(() => ({
  fetchHistoryMock: vi.fn(),
  fetchAgentDetailMock: vi.fn(),
  fetchAgentsMock: vi.fn(),
  getConversationMock: vi.fn(),
}));

vi.mock("@sico/shared/features/sidebar/components/sidebar.tsx", () => ({
  Sidebar: () => null,
}));

vi.mock("@sico/shared/features/chat/services/history.ts", () => ({
  fetchHistory: fetchHistoryMock,
}));

vi.mock("@sico/shared/features/chat/services/conversation.ts", () => ({
  getConversation: getConversationMock,
}));

vi.mock("@sico/shared/features/digital-worker/services/agents.ts", () => ({
  fetchAgentDetail: fetchAgentDetailMock,
  fetchAgents: fetchAgentsMock,
}));

function renderAt(path: string): { router: RegisteredRouter } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seedOrganizationContext(queryClient);
  const apiClient = {} as AxiosInstance;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, apiClient, store: createStore() },
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
    status: AgentStatusSchema.enum.ACTIVE,
  });
  fetchHistoryMock.mockResolvedValue({ items: [], hasNext: false });
  fetchAgentsMock.mockResolvedValue({ items: [], hasNext: false });
  getConversationMock.mockResolvedValue({ id: 55, title: "Scheduled run" });
});

afterEach(() => {
  if (vi.isMockFunction(QueryClient.prototype.prefetchQuery)) {
    vi.mocked(QueryClient.prototype.prefetchQuery).mockRestore();
  }
  if (vi.isMockFunction(QueryClient.prototype.prefetchInfiniteQuery)) {
    vi.mocked(QueryClient.prototype.prefetchInfiniteQuery).mockRestore();
  }
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

  it("disables the composer for an inactive worker's historical conversation", async () => {
    fetchAgentDetailMock.mockResolvedValue({
      id: 7,
      name: "Arena",
      role: "Tester",
      status: 4,
    });

    renderAt("/digital-worker/7/collaboration/55");

    expect(await screen.findByLabelText("Message input")).toBeDisabled();
    expect(screen.getByLabelText("Attach a file")).toBeDisabled();
  });

  it("prefetches exact conversation detail beside exact history", async () => {
    const prefetchQuerySpy = vi.spyOn(QueryClient.prototype, "prefetchQuery");
    const prefetchInfiniteQuerySpy = vi.spyOn(
      QueryClient.prototype,
      "prefetchInfiniteQuery",
    );

    renderAt("/digital-worker/7/collaboration/55");
    await screen.findByText("Arena");

    expect(prefetchQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["conversations", "detail", 55],
      }),
    );
    expect(prefetchInfiniteQuerySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          "history",
          "messages",
          { agentInstanceId: 7, conversationId: 55 },
        ],
      }),
    );
  });

  it("does not await optional conversation detail prefetch", async () => {
    getConversationMock.mockReturnValue(
      new Promise(() => {
        // Keep optional detail pending; navigation must still complete.
      }),
    );

    const { router } = renderAt("/digital-worker/7/collaboration/55");

    await screen.findByText("Arena");
    expect(screen.getByLabelText("Message input")).toBeInTheDocument();
    expect(getConversationMock).toHaveBeenCalledWith(expect.anything(), 55);
    expect(router.state.location.pathname).toBe(
      "/digital-worker/7/collaboration/55",
    );
  });

  it("renders not found without querying an invalid agent param", async () => {
    renderAt("/digital-worker/not-a-number/collaboration/55");

    await screen.findByRole("heading", { name: "Page not found" });
    expect(fetchAgentDetailMock).not.toHaveBeenCalled();
    expect(getConversationMock).not.toHaveBeenCalled();
    expect(fetchHistoryMock).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-number",
    "0",
    "-1",
    "1.5",
    String(Number.MAX_SAFE_INTEGER + 1),
  ])(
    "does not query detail or history for invalid conversationId %s",
    async (conversationId) => {
      const { router } = renderAt(
        `/digital-worker/7/collaboration/${conversationId}`,
      );

      await screen.findByText("Arena");
      expect(router.state.location.pathname).toBe("/digital-worker/7");
      expect(getConversationMock).not.toHaveBeenCalled();
      expect(fetchHistoryMock).not.toHaveBeenCalled();
    },
  );

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
