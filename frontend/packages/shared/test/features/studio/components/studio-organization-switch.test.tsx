import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import {
  AGENT_ENDPOINTS,
  ORGANIZATION_ENDPOINTS,
  RBAC_ENDPOINTS,
} from "@/constants/endpoints";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import type { OrganizationSummary } from "@/features/organization/schemas/organization";
import type { UserRole } from "@/features/rbac/schemas/user-role";
import { OrganizationAccountMenuSection } from "@/features/sidebar/components/organization-account-menu-section";
import { Studio } from "@/features/studio/components/studio";
import { StudioLayout } from "@/features/studio/components/studio-layout";
import { studioAgentsQueryOptions } from "@/features/studio/hooks/use-studio-agents-query";
import type { StudioAgent } from "@/features/studio/schemas/studio-agent";
import { ApiClientProvider } from "@/services/api-client-context";
import { persistLoginPayload } from "@/utils/auth-storage";
import {
  removeItemFromLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
} from "@/utils/local-storage";

import { makeLoginPayload } from "../../../helpers/organization-context";

function makeOrganizations(): OrganizationSummary[] {
  return ["Alpha", "Beta"].map((name, index) => ({
    id: index + 1,
    name,
    description: "",
    createdAt: 0,
    updatedAt: 0,
    creatorUsername: "owner",
    roleCodes: ["developer"],
    isOwner: false,
  }));
}

function replyWithRoles(apiMock: MockAdapter): void {
  const roles: UserRole[] = [1, 2].map((scopeId) => ({
    userId: 7,
    roleCode: "developer",
    scopeType: "org",
    scopeId,
  }));
  apiMock.onGet(RBAC_ENDPOINTS.userRoles).reply(200, {
    code: 0,
    msg: "",
    data: { roles, total: roles.length, hasNext: false },
  });
}

function agentParams(organizationId: number): {
  organizationId: number;
  publishStatusList: string;
  intent: number;
} {
  return { organizationId, publishStatusList: "0,1", intent: 0 };
}

function replyWithAgent(apiMock: MockAdapter, organizationId: number): void {
  const agent: StudioAgent = {
    agentId: `agent-${organizationId}`,
    name: organizationId === 1 ? "Alpha worker" : "Beta worker",
    role: "Researcher",
    desc: "Researches",
    creatorUsername: "owner",
    organizationId,
    publishStatus: 0,
  };
  apiMock
    .onGet(AGENT_ENDPOINTS.singleAgents, {
      params: agentParams(organizationId),
    })
    .reply(200, {
      code: 0,
      msg: "",
      data: { agents: [agent], total: 1, hasNext: false },
    });
}

const queryClients: QueryClient[] = [];

function renderStudio(failure: "agents" | "roles"): {
  store: ReturnType<typeof createStore>;
  apiMock: MockAdapter;
  queryClient: QueryClient;
  betaQueryKey: readonly unknown[];
  history: ReturnType<typeof createMemoryHistory>;
} {
  const store = createStore();
  store.set(userAtom, { id: 7, email: "developer@sico.test", roles: [] });
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: 0 },
    },
  });
  queryClients.push(queryClient);
  const apiClient = axios.create();
  const apiMock = new MockAdapter(apiClient, { onNoMatch: "throwException" });
  const organizations = makeOrganizations();
  apiMock.onGet(ORGANIZATION_ENDPOINTS.list).reply(200, {
    code: 0,
    msg: "",
    data: { organizations, total: organizations.length, hasNext: false },
  });
  replyWithRoles(apiMock);
  replyWithAgent(apiMock, 1);
  replyWithAgent(apiMock, 2);
  if (failure === "agents") {
    apiMock
      .onGet(AGENT_ENDPOINTS.singleAgents, { params: agentParams(1) })
      .reply(500);
  } else {
    apiMock.onGet(RBAC_ENDPOINTS.userRoles).reply(500);
  }

  const rootRoute = createRootRoute({
    component: function Root() {
      return (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger>Account options</DropdownMenuTrigger>
            <DropdownMenuContent>
              <OrganizationAccountMenuSection />
            </DropdownMenuContent>
          </DropdownMenu>
          <Outlet />
        </>
      );
    },
  });
  const studioRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/studio/all",
    component: function StudioRoute() {
      return (
        <StudioLayout>
          <Studio activeTab="all" />
        </StudioLayout>
      );
    },
  });
  const history = createMemoryHistory({ initialEntries: ["/studio/all"] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([studioRoute]),
    history,
  });
  render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return {
    store,
    apiMock,
    queryClient,
    betaQueryKey: studioAgentsQueryOptions(apiClient, {
      type: "organization",
      organizationId: 2,
    }).queryKey,
    history,
  };
}

async function selectBeta(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Account options" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Switch Organization" }),
  );
  await user.keyboard("{ArrowRight}{ArrowDown}{Enter}{Escape}{Escape}");
}

beforeEach(() => persistLoginPayload(makeLoginPayload(7)));
afterEach(() => {
  for (const queryClient of queryClients.splice(0)) {
    queryClient.clear();
  }
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
});

describe("Studio organization error recovery", () => {
  it("loads the newly selected organization's agents after a list error on the same path", async () => {
    const user = userEvent.setup();
    const { apiMock, store, queryClient, betaQueryKey, history } =
      renderStudio("agents");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong on our end. Try again in a moment.",
    );
    expect(screen.getByRole("heading", { name: "Studio" })).toBeVisible();
    expect(apiMock.history.get).toContainEqual(
      expect.objectContaining({
        url: AGENT_ENDPOINTS.singleAgents,
        params: agentParams(1),
      }),
    );
    expect(queryClient.getQueryData(betaQueryKey)).toBeUndefined();

    await selectBeta(user);

    expect(store.get(selectedOrganizationIdAtom)).toBe(2);
    expect(
      await screen.findByRole("link", { name: "Open Beta worker's setup" }),
    ).toBeVisible();
    expect(apiMock.history.get).toContainEqual(
      expect.objectContaining({
        url: AGENT_ENDPOINTS.singleAgents,
        params: agentParams(2),
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(history.location.pathname).toBe("/studio/all");
  });

  it("retries failed permissions after selecting another organization on the same path", async () => {
    const user = userEvent.setup();
    const { apiMock, store, queryClient, betaQueryKey, history } =
      renderStudio("roles");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong on our end. Try again in a moment.",
    );
    expect(
      screen.queryByRole("heading", { name: "Studio" }),
    ).not.toBeInTheDocument();
    expect(queryClient.getQueryData(betaQueryKey)).toBeUndefined();
    replyWithRoles(apiMock);

    await selectBeta(user);

    expect(store.get(selectedOrganizationIdAtom)).toBe(2);
    expect(
      await screen.findByRole("link", { name: "Open Beta worker's setup" }),
    ).toBeVisible();
    expect(
      apiMock.history.get.filter(({ url }) => url === RBAC_ENDPOINTS.userRoles),
    ).toHaveLength(2);
    expect(apiMock.history.get).toContainEqual(
      expect.objectContaining({
        url: AGENT_ENDPOINTS.singleAgents,
        params: agentParams(2),
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(history.location.pathname).toBe("/studio/all");
  });

  it.each(["agents", "roles"] as const)(
    "still recovers from a %s error with Try again without changing organization",
    async (failure) => {
      const user = userEvent.setup();
      const { apiMock, history } = renderStudio(failure);
      await screen.findByRole("alert");
      if (failure === "agents") {
        replyWithAgent(apiMock, 1);
      } else {
        replyWithRoles(apiMock);
      }

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(
        await screen.findByRole("link", { name: "Open Alpha worker's setup" }),
      ).toBeVisible();
      const retriedEndpoint =
        failure === "agents"
          ? AGENT_ENDPOINTS.singleAgents
          : RBAC_ENDPOINTS.userRoles;
      expect(
        apiMock.history.get.filter(({ url }) => url === retriedEndpoint),
      ).toHaveLength(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(history.location.pathname).toBe("/studio/all");
    },
  );
});
