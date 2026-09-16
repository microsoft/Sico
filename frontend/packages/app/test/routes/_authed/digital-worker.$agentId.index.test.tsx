import { ApiClientProvider } from "@sico/shared";
import { chatKeys } from "@sico/shared/features/chat/index.ts";
import { AgentStatusSchema } from "@sico/shared/features/digital-worker/index.ts";
import { persistLoginPayload } from "@sico/shared/utils/auth-storage.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  type RegisteredRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import type { AxiosInstance } from "axios";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../src/routeTree.gen";
import { clearAuthStorage } from "../../_helpers/clear-auth-storage";
import { seedOrganizationContext } from "../../_helpers/organization-context";

// The bare `/digital-worker/$agentId` index is now ALWAYS the DigitalWorkerHome
// (hero + composer + suggested tasks) — fully decoupled from chat, no history
// probe, no redirect. It reads agent detail (Header + hero) and the onboarding
// recommendation list.
const { fetchAgentDetailMock, listConversationsMock } = vi.hoisted(() => ({
  fetchAgentDetailMock: vi.fn(),
  listConversationsMock: vi.fn(),
}));

vi.mock("@sico/shared/features/sidebar/components/sidebar.tsx", () => ({
  Sidebar: () => null,
}));

vi.mock("@sico/shared/features/digital-worker/services/agents.ts", () => ({
  fetchAgentDetail: fetchAgentDetailMock,
  fetchAgents: vi.fn(),
}));

vi.mock("@sico/shared/features/chat/services/recommendation.ts", () => ({
  fetchRecommendationTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("@sico/shared/features/chat/services/conversation.ts", () => ({
  listConversations: listConversationsMock,
}));

function renderAt(
  agentId: string,
  seed?: (queryClient: QueryClient) => void,
): { queryClient: QueryClient; router: RegisteredRouter } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seedOrganizationContext(queryClient);
  seed?.(queryClient);
  const apiClient = {} as AxiosInstance;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/digital-worker/${agentId}`],
    }),
    context: { queryClient, apiClient, store: createStore() },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <RouterProvider router={router} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router };
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
  listConversationsMock.mockResolvedValue({ items: [], hasNext: false });
});

afterEach(() => {
  vi.clearAllMocks();
  clearAuthStorage();
});

describe("/_authed/digital-worker/$agentId/ index landing", () => {
  it("renders the DigitalWorkerHome", async () => {
    renderAt("7");
    expect(
      await screen.findByText("How can I help you today?"),
    ).toBeInTheDocument();
  });

  it("stays on the index path (no redirect)", async () => {
    const { router } = renderAt("7");
    await screen.findByText("How can I help you today?");
    expect(router.state.location.pathname).toBe("/digital-worker/7");
  });

  it("redirects an inactive worker to its newest conversation", async () => {
    fetchAgentDetailMock.mockResolvedValue({
      id: 7,
      name: "Arena",
      role: "Tester",
      status: 4,
    });
    listConversationsMock.mockResolvedValue({
      items: [
        { id: 91, title: "Newest", conversationStatus: 0 },
        { id: 72, title: "Older", conversationStatus: 0 },
      ],
      hasNext: false,
    });

    const { router } = renderAt("7");

    await screen.findByText("Arena");
    expect(router.state.location.pathname).toBe(
      "/digital-worker/7/collaboration/91",
    );
  });

  it("waits for invalidated agent detail before deciding the inactive redirect", async () => {
    let resolveAgent:
      | ((agent: {
          id: number;
          name: string;
          role: string;
          status: number;
        }) => void)
      | undefined;
    fetchAgentDetailMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAgent = resolve;
      }),
    );
    listConversationsMock.mockResolvedValue({
      items: [{ id: 91, title: "Newest", conversationStatus: 0 }],
      hasNext: false,
    });

    const { router } = renderAt("7", (queryClient) => {
      const queryKey = ["agents", "detail", 7] as const;
      queryClient.setQueryData(queryKey, {
        id: 7,
        name: "Arena",
        role: "Tester",
        status: AgentStatusSchema.enum.ACTIVE,
      });
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    });
    await waitFor(() => expect(fetchAgentDetailMock).toHaveBeenCalled());
    resolveAgent?.({
      id: 7,
      name: "Arena",
      role: "Tester",
      status: AgentStatusSchema.enum.INACTIVE,
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/digital-worker/7/collaboration/91",
      ),
    );
  });

  it("uses a refreshed conversation list for the inactive redirect", async () => {
    let resolveConversations:
      | ((page: {
          items: { id: number; title: string; conversationStatus: number }[];
          hasNext: boolean;
        }) => void)
      | undefined;
    fetchAgentDetailMock.mockResolvedValue({
      id: 7,
      name: "Arena",
      role: "Tester",
      status: AgentStatusSchema.enum.INACTIVE,
    });
    listConversationsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveConversations = resolve;
      }),
    );

    const { router } = renderAt("7", (queryClient) => {
      const queryKey = chatKeys.conversationList(7);
      queryClient.setQueryData(queryKey, {
        pages: [
          {
            items: [{ id: 72, title: "Old", conversationStatus: 0 }],
            hasNext: false,
          },
        ],
        pageParams: [1],
      });
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    });
    await waitFor(() => expect(listConversationsMock).toHaveBeenCalled());
    resolveConversations?.({
      items: [{ id: 91, title: "Newest", conversationStatus: 0 }],
      hasNext: false,
    });

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        "/digital-worker/7/collaboration/91",
      ),
    );
  });

  it("shows a disabled composer when an inactive worker has no history", async () => {
    fetchAgentDetailMock.mockResolvedValue({
      id: 7,
      name: "Arena",
      role: "Tester",
      status: 4,
    });

    renderAt("7");

    expect(await screen.findByLabelText("Message input")).toBeDisabled();
  });
});
