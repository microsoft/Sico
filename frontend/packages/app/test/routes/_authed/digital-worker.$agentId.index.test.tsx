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

// The bare `/digital-worker/$agentId` index is now ALWAYS the DigitalWorkerHome
// (hero + composer + suggested tasks) — fully decoupled from chat, no history
// probe, no redirect. It reads agent detail (Header + hero) and the onboarding
// recommendation list.
const { fetchAgentDetailMock } = vi.hoisted(() => ({
  fetchAgentDetailMock: vi.fn(),
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

function renderAt(agentId: string): { router: RegisteredRouter } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const apiClient = {} as AxiosInstance;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/digital-worker/${agentId}`],
    }),
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
});
