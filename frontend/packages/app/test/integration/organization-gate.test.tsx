import {
  ApiClientProvider,
  createApiClient,
  getBoundOrganizationId,
  loginAtom,
  logoutAtom,
  userAtom,
} from "@sico/shared";
import { selectedOrganizationIdAtom } from "@sico/shared/features/organization/atoms/selected-organization-atom.ts";
import { userOrganizationsQueryOptions } from "@sico/shared/features/organization/hooks/use-organization-query.ts";
import { organizationKeys } from "@sico/shared/features/organization/query-keys.ts";
import { organizationContextCacheSchema } from "@sico/shared/features/organization/schemas/organization-context-cache.ts";
import { getAccessToken } from "@sico/shared/utils/auth-storage.ts";
import {
  ORGANIZATION_CONTEXT_LS,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
} from "@sico/shared/utils/local-storage.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  type RegisteredRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  render,
  type RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "../../src/routeTree.gen";
import { clearAuthStorage } from "../_helpers/clear-auth-storage";
import { setupMswServer } from "../_helpers/msw-server";
import { makeOrganization } from "../_helpers/organization-context";

const MEMBERSHIPS = "/api/sico/organization/user_organizations";
const DETAIL = "/api/sico/agent/single_agent_instance";
const LIST = "/api/sico/agent/single_agent_instances";
const HISTORY = "/api/sico/conversation/messages";
const CONVERSATION = "/api/sico/conversation";
const CONVERSATIONS = "/api/sico/conversation/list";
const CHAT_PATH = "/digital-worker/904/collaboration/1942";

const server = setupMswServer([]);
const clients: QueryClient[] = [];
const stores: ReturnType<typeof createStore>[] = [];

type Harness = {
  store: ReturnType<typeof createStore>;
  queryClient: QueryClient;
  apiClient: AxiosInstance;
  router: RegisteredRouter;
  mount: () => RenderResult;
};

function makeHarness(path = CHAT_PATH): Harness {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  stores.push(store);
  store.set(loginAtom, {
    tokenInfo: {
      accessToken: "gate-session",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    user: { id: 1, email: "gate@example.test", roles: [] },
  });
  const apiClient = createApiClient({
    baseURL: "/api/sico",
    store,
    getOrganizationId: () => getBoundOrganizationId(store, queryClient),
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { store, queryClient, apiClient },
    defaultPendingMinMs: 0,
  });
  return {
    store,
    queryClient,
    apiClient,
    router,
    mount: () =>
      render(
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <ApiClientProvider client={apiClient}>
              <RouterProvider router={router} />
            </ApiClientProvider>
          </QueryClientProvider>
        </Provider>,
      ),
  };
}

function membershipResponse(
  organizations = [makeOrganization(9), makeOrganization(10)],
): Response {
  return HttpResponse.json({
    code: 0,
    msg: "ok",
    data: { organizations, total: organizations.length, hasNext: false },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise resolver is not initialized");
  };
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function holdMemberships(): {
  started: Promise<void>;
  release: (response: Response) => void;
} {
  const started = deferred<void>();
  const response = deferred<Response>();
  server.use(
    http.get(MEMBERSHIPS, async () => {
      started.resolve();
      return response.promise;
    }),
  );
  return { started: started.promise, release: response.resolve };
}

function observeBusinessRequests(): {
  requests: Request[];
  started: Promise<void>;
} {
  const started = deferred<void>();
  const requests: Request[] = [];
  const dataByPath = new Map<string, unknown>([
    [
      DETAIL,
      { instance: { id: 904, name: "Gate worker", role: "Tester", status: 2 } },
    ],
    [LIST, { instances: [], total: 0, hasNext: false }],
    [HISTORY, { messages: [], hasMore: false }],
    [CONVERSATION, { id: 1942, title: "Gate conversation" }],
    [CONVERSATIONS, { conversations: [], hasMore: false }],
    ["/api/sico/rbac/user_roles", { roles: [], total: 0, hasNext: false }],
    [
      "/api/sico/project/user_projects",
      { projects: [], total: 0, hasNext: false },
    ],
    ["/api/sico/agent/single_agents", { agents: [], total: 0, hasNext: false }],
  ]);
  server.use(
    ...[...dataByPath].map(([path, data]) =>
      http.all(path, ({ request }) => {
        requests.push(request);
        started.resolve();
        return HttpResponse.json({ code: 0, msg: "ok", data });
      }),
    ),
  );
  return { requests, started: started.promise };
}

beforeEach(() => {
  clearAuthStorage();
});

afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) {
    store.set(logoutAtom);
  }
  for (const client of clients.splice(0)) {
    client.clear();
  }
  clearAuthStorage();
});

function failureResponse(): Response {
  return HttpResponse.json({
    code: 100001,
    msg: "private backend diagnostic",
    data: null,
  });
}

function replaceSession(
  store: ReturnType<typeof createStore>,
  userId: number,
): void {
  store.set(loginAtom, {
    tokenInfo: {
      accessToken: "replacement-session",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    user: { id: userId, email: "replacement@example.test", roles: [] },
  });
}

function persistOrganizations(userId = 1): void {
  safeSetItemToLocalStorage(
    ORGANIZATION_CONTEXT_LS,
    organizationContextCacheSchema,
    {
      version: 1,
      userId,
      organizations: [makeOrganization(10)],
    },
  );
}

function readOrganizationCache(): ReturnType<
  typeof organizationContextCacheSchema.parse
> | null {
  return safeGetItemFromLocalStorage(
    ORGANIZATION_CONTEXT_LS,
    organizationContextCacheSchema,
  );
}

describe("global organization route gate", () => {
  it.each(["memory", "localStorage"])(
    "does not delay a ready %s route behind the pending UI",
    async (cache) => {
      observeBusinessRequests();
      const harness = makeHarness("/organization/members");
      if (cache === "memory") {
        harness.queryClient.setQueryData(
          organizationKeys.userOrganizations(1),
          [makeOrganization(10)],
        );
      } else {
        persistOrganizations();
      }
      vi.useFakeTimers();
      try {
        // A ready route must commit without advancing any pending/minimum timer.
        await act(async () => {
          harness.mount();
        });
        expect(harness.router.state.isLoading).toBe(false);
        expect(
          harness.router.state.matches.find(
            (match) => match.routeId === "/_authed",
          )?.status,
        ).toBe("success");
        expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("rejects a missing store user before initialization even with a valid LS token", async () => {
    let membershipRequests = 0;
    server.use(
      http.get(MEMBERSHIPS, () => {
        membershipRequests += 1;
        return membershipResponse();
      }),
    );
    const business = observeBusinessRequests();
    const harness = makeHarness();
    harness.store.set(userAtom, null);
    await harness.router.load();
    expect(harness.router.state.location.pathname).toBe("/login");
    expect(membershipRequests).toBe(0);
    expect(
      business.requests.map((request) => new URL(request.url).pathname),
    ).toEqual([]);
  });

  it("does not cancel another consumer's shared membership query on navigation", async () => {
    const memberships = holdMemberships();
    const business = observeBusinessRequests();
    const harness = makeHarness();
    const loading = harness.router.load();
    await memberships.started;
    const otherConsumer = harness.queryClient.fetchQuery(
      userOrganizationsQueryOptions(harness.apiClient, 1),
    );
    await harness.router.navigate({ href: "/landing/index.html" });
    memberships.release(membershipResponse());
    await loading;
    expect(await otherConsumer).toEqual([
      makeOrganization(9),
      makeOrganization(10),
    ]);
    expect(harness.router.state.location.pathname).toBe("/landing/index.html");
    expect(
      business.requests.map((request) => new URL(request.url).pathname),
    ).toEqual([]);
  });

  it.each(["memory", "localStorage"])(
    "reuses valid %s membership without an initialization fetch",
    async (cache) => {
      const business = observeBusinessRequests();
      let membershipRequests = 0;
      server.use(
        http.get(MEMBERSHIPS, () => {
          membershipRequests += 1;
          return membershipResponse();
        }),
      );
      const harness = makeHarness();
      if (cache === "memory") {
        harness.queryClient.setQueryData(
          organizationKeys.userOrganizations(1),
          [makeOrganization(10)],
        );
      } else {
        persistOrganizations();
      }
      await harness.router.load();
      await waitFor(() =>
        expect(
          business.requests.map((request) => new URL(request.url).pathname),
        ).toContain(HISTORY),
      );
      expect(membershipRequests).toBe(0);
      expect(
        business.requests.every(
          (request) => request.headers.get("X-Sico-Organization-ID") === "10",
        ),
      ).toBe(true);
    },
  );

  it.each(["/", "/login", "/register", "/landing/index.html"])(
    "does not initialize organizations on public %s",
    async (path) => {
      let membershipRequests = 0;
      server.use(
        http.get(MEMBERSHIPS, () => {
          membershipRequests += 1;
          return membershipResponse();
        }),
      );
      const harness = makeHarness(path);
      harness.store.set(logoutAtom);
      await harness.router.load();
      expect(membershipRequests).toBe(0);
      expect(
        harness.queryClient.getQueryData(organizationKeys.userOrganizations(1)),
      ).toBeUndefined();
    },
  );

  it.each(["/digital-worker", "/project", "/studio/all", CHAT_PATH])(
    "redirects empty memberships from %s before business requests",
    async (path) => {
      server.use(http.get(MEMBERSHIPS, () => membershipResponse([])));
      const business = observeBusinessRequests();
      const harness = makeHarness(path);
      await harness.router.load();
      expect(harness.router.state.location.pathname).toBe(
        "/organization/members",
      );
      expect(
        business.requests.map((request) => new URL(request.url).pathname),
      ).toEqual([]);
      expect(
        harness.queryClient.getQueryData(organizationKeys.userOrganizations(1)),
      ).toEqual([]);
    },
  );

  it.each(["/organization", "/organization/members", "/organization/projects"])(
    "allows the existing organization empty UI at %s without a loop",
    async (path) => {
      server.use(http.get(MEMBERSHIPS, () => membershipResponse([])));
      const harness = makeHarness(path);
      await harness.router.load();
      harness.mount();
      expect(
        await screen.findByText("No organization available"),
      ).toBeVisible();
      expect(harness.router.state.location.pathname).toBe(
        path === "/organization" ? "/organization/members" : path,
      );
    },
  );

  it("shows safe retry UI and retries initialization before allowing descendants", async () => {
    server.use(http.get(MEMBERSHIPS, failureResponse));
    const business = observeBusinessRequests();
    const harness = makeHarness();
    harness.mount();
    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(harness.router.state.isLoading).toBe(false));
    expect(
      screen.getByText("Something went wrong on this page. Try again."),
    ).toBeVisible();
    expect(screen.queryByText("private backend diagnostic")).toBeNull();
    expect(
      business.requests.map((request) => new URL(request.url).pathname),
    ).toEqual([]);
    // Retry to the existing empty UI, avoiding irrelevant chat mount effects.
    server.use(http.get(MEMBERSHIPS, () => membershipResponse([])));
    await userEvent.setup().click(retry);
    expect(await screen.findByText("No organization available")).toBeVisible();
    expect(harness.router.state.location.pathname).toBe(
      "/organization/members",
    );
    // The allowed organization shell may load its permission snapshot, but
    // the original DW route must never start any reads or writes.
    expect(
      business.requests
        .map((request) => new URL(request.url).pathname)
        .filter((path) => path !== "/api/sico/rbac/user_roles"),
    ).toEqual([]);
  });

  it.each(["success", "failure"])(
    "redirects logout during pending initialization on %s without business cache writes",
    async (outcome) => {
      const memberships = holdMemberships();
      const business = observeBusinessRequests();
      const harness = makeHarness();
      const loading = harness.router.load();
      await memberships.started;
      harness.store.set(logoutAtom);
      memberships.release(
        outcome === "success" ? membershipResponse() : failureResponse(),
      );
      await loading;
      expect(harness.router.state.location.pathname).toBe("/login");
      expect(harness.router.state.location.search).toMatchObject({
        next: CHAT_PATH,
      });
      expect(
        business.requests.map((request) => new URL(request.url).pathname),
      ).toEqual([]);
      expect(
        harness.queryClient.getQueryData(["agents", "detail", 904]),
      ).toBeUndefined();
      expect(readOrganizationCache()).toBeNull();
    },
  );

  it("redirects a membership 401 without allowing protected requests", async () => {
    server.use(
      http.get(MEMBERSHIPS, () =>
        HttpResponse.json({ code: 401, msg: "unauthorized" }, { status: 401 }),
      ),
    );
    const business = observeBusinessRequests();
    const harness = makeHarness();
    await harness.router.load();
    expect(harness.router.state.location.pathname).toBe("/login");
    expect(harness.store.get(userAtom)).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(
      business.requests.map((request) => new URL(request.url).pathname),
    ).toEqual([]);
  });

  it.each([
    { userId: 2, outcome: "success" },
    { userId: 2, outcome: "failure" },
    { userId: 1, outcome: "success" },
    { userId: 1, outcome: "failure" },
    { userId: 1, outcome: "unauthorized" },
  ])(
    "preserves replacement user $userId after old initialization $outcome",
    async ({ userId, outcome }) => {
      const memberships = holdMemberships();
      const business = observeBusinessRequests();
      const harness = makeHarness();
      const loading = harness.router.load();
      await memberships.started;
      replaceSession(harness.store, userId);
      persistOrganizations(userId);
      const response =
        outcome === "success" ? membershipResponse() : failureResponse();
      memberships.release(
        outcome === "unauthorized"
          ? HttpResponse.json(
              { code: 401, msg: "unauthorized" },
              { status: 401 },
            )
          : response,
      );
      await loading;
      expect(harness.store.get(userAtom)?.id).toBe(userId);
      expect(getAccessToken()).toBe("replacement-session");
      expect(harness.router.state.location.pathname).toBe(CHAT_PATH);
      const gate = harness.router.state.matches.find(
        (match) => match.routeId === "/_authed",
      );
      expect(gate?.status).toBe("error");
      expect(gate?.error).toBeInstanceOf(Error);
      expect(
        business.requests.map((request) => new URL(request.url).pathname),
      ).toEqual([]);
      expect(
        harness.queryClient.getQueryData(["agents", "detail", 904]),
      ).toBeUndefined();
      expect(readOrganizationCache()).toMatchObject({
        userId,
        organizations: [{ id: 10 }],
      });
    },
  );

  it.each(["success", "failure"])(
    "does not steal canceled navigation when old initialization settles with %s",
    async (outcome) => {
      const memberships = holdMemberships();
      const business = observeBusinessRequests();
      const harness = makeHarness();
      const loading = harness.router.load();
      await memberships.started;
      harness.store.set(logoutAtom);
      await harness.router.navigate({ to: "/register" });
      harness.queryClient.setQueryData(["new-navigation"], "retain");
      memberships.release(
        outcome === "success" ? membershipResponse() : failureResponse(),
      );
      await loading;
      expect(harness.router.state.location.pathname).toBe("/register");
      expect(harness.queryClient.getQueryData(["new-navigation"])).toBe(
        "retain",
      );
      expect(
        business.requests.map((request) => new URL(request.url).pathname),
      ).toEqual([]);
      expect(
        harness.queryClient.getQueryData(["agents", "detail", 904]),
      ).toBeUndefined();
    },
  );

  it.each([
    { selection: 10, expected: "10" },
    { selection: null, expected: "9" },
    { selection: 999, expected: "9" },
  ])(
    "holds cold detail/history requests and sends the validated organization ($selection)",
    async ({ selection, expected }) => {
      const memberships = holdMemberships();
      const business = observeBusinessRequests();
      const harness = makeHarness();
      harness.store.set(selectedOrganizationIdAtom, selection);
      const loading = harness.router.load();
      try {
        // Old code reaches the business request first; the fixed gate reaches
        // membership first. This observable barrier fails RED without a sleep.
        await Promise.race([memberships.started, business.started]);
        expect(
          business.requests.map((request) => ({
            path: new URL(request.url).pathname,
            organization: request.headers.get("X-Sico-Organization-ID"),
          })),
        ).toEqual([]);
      } finally {
        memberships.release(membershipResponse());
        await loading;
      }
      await waitFor(() => {
        expect(
          business.requests.map((request) => new URL(request.url).pathname),
        ).toContain(HISTORY);
      });
      expect(
        business.requests.map((request) => new URL(request.url).pathname),
      ).toContain(DETAIL);
      expect(
        business.requests.every(
          (request) =>
            request.headers.get("X-Sico-Organization-ID") === expected,
        ),
      ).toBe(true);
    },
  );

  it("holds mounted DW page effects and loaders until membership is ready", async () => {
    const memberships = holdMemberships();
    const business = observeBusinessRequests();
    const harness = makeHarness("/digital-worker");
    harness.mount();
    try {
      await Promise.race([memberships.started, business.started]);
      expect(
        await screen.findByRole("status", { name: "Loading" }),
      ).toBeVisible();
      expect(
        business.requests.map((request) => new URL(request.url).pathname),
      ).toEqual([]);
      expect(
        screen.queryByRole("button", { name: "Scheduled task" }),
      ).toBeNull();
    } finally {
      memberships.release(membershipResponse());
    }
    await screen.findByRole("button", { name: "Scheduled task" });
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();
    await waitFor(() => expect(harness.queryClient.isFetching()).toBe(0));
    expect(
      business.requests.map((request) => new URL(request.url).pathname),
    ).toContain(LIST);
    expect(
      business.requests.every(
        (request) => request.headers.get("X-Sico-Organization-ID") === "9",
      ),
    ).toBe(true);
  });

  it("holds the cold DW list loader until membership is ready", async () => {
    const memberships = holdMemberships();
    const business = observeBusinessRequests();
    const harness = makeHarness("/digital-worker");
    const loading = harness.router.load();
    try {
      await Promise.race([memberships.started, business.started]);
      expect(
        business.requests.map((request) => ({
          path: new URL(request.url).pathname,
          organization: request.headers.get("X-Sico-Organization-ID"),
        })),
      ).toEqual([]);
    } finally {
      memberships.release(membershipResponse());
      await loading;
    }
    await waitFor(() => expect(business.requests).not.toHaveLength(0));
    expect(
      business.requests.every(
        (request) => request.headers.get("X-Sico-Organization-ID") === "9",
      ),
    ).toBe(true);
  });
});
