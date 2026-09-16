import { ApiClientProvider } from "@sico/shared";
import { persistLoginPayload } from "@sico/shared/utils/auth-storage.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../../src/routeTree.gen";
import { clearAuthStorage } from "../../_helpers/clear-auth-storage";
import { seedOrganizationContext } from "../../_helpers/organization-context";

const { fetchAgentsMock, fetchScheduledTasksMock } = vi.hoisted(() => ({
  fetchAgentsMock: vi.fn(),
  fetchScheduledTasksMock: vi.fn(),
}));

vi.mock("@sico/shared/features/sidebar/components/sidebar.tsx", () => ({
  Sidebar: () => null,
}));

vi.mock(
  "@sico/shared/features/digital-worker/services/agents.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@sico/shared/features/digital-worker/services/agents.ts")
      >();
    return { ...actual, fetchAgents: fetchAgentsMock };
  },
);

vi.mock(
  "@sico/shared/features/scheduled-task/services/scheduled-tasks.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@sico/shared/features/scheduled-task/services/scheduled-tasks.ts")
      >();
    return { ...actual, fetchScheduledTasks: fetchScheduledTasksMock };
  },
);

vi.mock(
  "@sico/shared/features/organization/services/organization.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@sico/shared/features/organization/services/organization.ts")
      >();
    return { ...actual, fetchUserOrganizations: vi.fn().mockResolvedValue([]) };
  },
);

vi.mock(
  "@sico/shared/features/rbac/services/user-role.ts",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@sico/shared/features/rbac/services/user-role.ts")
      >();
    return { ...actual, fetchUserRoles: vi.fn().mockResolvedValue([]) };
  },
);

beforeEach(() => {
  persistLoginPayload({
    tokenInfo: {
      accessToken: "tok",
      expiresAt: Math.floor(Date.now() / 1000) + 3_600,
    },
    user: { id: 1, email: "user@example.com", roles: [] },
  });
  fetchAgentsMock.mockResolvedValue({ items: [], total: 0, hasNext: false });
  fetchScheduledTasksMock.mockResolvedValue({
    items: [],
    total: 0,
    hasNext: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  clearAuthStorage();
});

describe("/_authed/digital-worker", () => {
  it("opens and closes scheduled task management without changing the route", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedOrganizationContext(queryClient);
    const apiClient = axios.create({ baseURL: "/api/sico" });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/digital-worker"] }),
      context: { queryClient, apiClient, store: createStore() },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>,
    );

    const trigger = await screen.findByRole("button", {
      name: "Scheduled task",
    });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Scheduled task" });
    expect(router.state.location.pathname).toBe("/digital-worker");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe("/digital-worker");
  });
});
