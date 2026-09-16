import { ApiClientProvider } from "@sico/shared";
import { chatKeys } from "@sico/shared/features/chat/index.ts";
import { AgentStatusSchema } from "@sico/shared/features/digital-worker/index.ts";
import { persistLoginPayload } from "@sico/shared/utils/auth-storage.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  isNotFound,
  type RegisteredRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import axios, { AxiosError, type AxiosInstance } from "axios";
import { createStore } from "jotai";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

import { Route } from "../../../src/routes/_authed/digital-worker.$agentId";
import { routeTree } from "../../../src/routeTree.gen";
import { clearAuthStorage } from "../../_helpers/clear-auth-storage";
import { seedOrganizationContext } from "../../_helpers/organization-context";

// --- Regression harness for the agent-detail error boundary ---
// `<DwAgentLayout>` calls strict `Route.useParams()`, so it only resolves
// under the REAL route tree, which drags in `<AppShell>` → `<Sidebar>` and
// a suspense `<Header>` that fetches agent detail. Flatten that: stub the
// Sidebar, force `fetchAgentDetail` to fail with a network-bucket error,
// and seed a valid session (`beforeEach`) so `_authed.beforeLoad` +
// `<AuthGate>` pass.
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

// The collaboration child drives `useHistory` (non-suspense) on mount. A
// history failure no longer throws to any boundary — it toasts in-place — so it
// can't steal the agent-detail boundary this suite exercises. Stub it to resolve
// empty anyway, to keep an unmocked reject from spewing toast + logger noise
// into these agent-detail assertions. (The reconnect probe is fire-and-forget
// `void`+`.catch()`, so its unmocked network failure needs no stub.)
vi.mock("@sico/shared/features/chat/services/history.ts", () => ({
  fetchHistory: vi.fn().mockResolvedValue({ items: [], hasNext: false }),
}));

function axiosErrorNoResponse(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK");
}

function renderAgentRoute(initialAgentId = "7"): { router: RegisteredRouter } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seedOrganizationContext(queryClient);
  const apiClient = {} as AxiosInstance;
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/digital-worker/${initialAgentId}`],
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
  return { router: router as unknown as RegisteredRouter };
}

function getBeforeLoad(): Extract<
  NonNullable<typeof Route.options.beforeLoad>,
  CallableFunction
> {
  const beforeLoad = Route.options.beforeLoad;
  if (typeof beforeLoad !== "function") {
    throw new Error("digital worker route beforeLoad must be a function");
  }
  return beforeLoad;
}

describe("/_authed/digital-worker/$agentId beforeLoad", () => {
  it.each(["abc", "0", "-1", "1.5", String(Number.MAX_SAFE_INTEGER + 1)])(
    "throws notFound() for invalid agentId %s",
    (agentId) => {
      try {
        Reflect.apply(getBeforeLoad(), undefined, [{ params: { agentId } }]);
        throw new Error("expected notFound()");
      } catch (error) {
        expect(isNotFound(error)).toBe(true);
      }
    },
  );

  it("allows a positive safe integer agentId", () => {
    expect(
      Reflect.apply(getBeforeLoad(), undefined, [
        { params: { agentId: "42" } },
      ]),
    ).toBeUndefined();
  });
});

// Unit test for the layout route's loader prefetches (agent detail + the
// sidebar conversation list). The generated loader context type is complex,
// so we narrow `Route.options` to a callable shape — the same pattern the
// sibling `project.$projectId` overload test uses for `beforeLoad`. The fake
// `queryClient` exposes only the two prefetch methods the loader calls;
// `apiClient` is a real axios instance the loader never calls (it's stored
// unread inside the query-options closure).
type FakeContext = {
  queryClient: { prefetchQuery: Mock; prefetchInfiniteQuery: Mock };
  apiClient: AxiosInstance;
};

type LoaderShape = {
  loader: (args: { context: FakeContext; params: { agentId: string } }) => void;
};

const opts = Route.options as Partial<LoaderShape> as LoaderShape;

function makeContext(): FakeContext {
  return {
    queryClient: { prefetchQuery: vi.fn(), prefetchInfiniteQuery: vi.fn() },
    apiClient: axios.create({ baseURL: "/api/sico" }),
  };
}

describe("/_authed/digital-worker/$agentId loader", () => {
  it("prefetches agent detail for a numeric agentId", () => {
    const context = makeContext();
    opts.loader({ context, params: { agentId: "7" } });
    expect(context.queryClient.prefetchQuery).toHaveBeenCalledTimes(1);
    expect(context.queryClient.prefetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["agents", "detail", 7] }),
    );
  });

  it("prefetches the conversation list for a numeric agentId", () => {
    const context = makeContext();
    opts.loader({ context, params: { agentId: "7" } });
    expect(context.queryClient.prefetchInfiniteQuery).toHaveBeenCalledTimes(1);
    expect(context.queryClient.prefetchInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: chatKeys.conversationList(7),
      }),
    );
  });
});

describe("/_authed/digital-worker/$agentId agent-detail error boundary", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Seed a valid session so `_authed.beforeLoad` (`getAccessToken`) and
    // `<AuthGate>` (`userAtom`/`loadFromLS`) both resolve truthy. The default
    // jotai store reads LS lazily on first `get`, so seeding before render is
    // seen; `cleanup()` unmounts `<AuthGate>` between tests, dropping the read.
    persistLoginPayload({
      tokenInfo: {
        accessToken: "tok",
        expiresAt: Math.floor(Date.now() / 1000) + 3_600,
      },
      user: { id: 1, email: "user@example.com", roles: [] },
    });
    // Silence React's expected error-boundary console.error for the
    // deliberate Header throw (pattern from app.test.tsx).
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    clearAuthStorage();
  });

  it("renders the shared ErrorView here, not AppShell's InnerErrorFallback, when agent detail fails", async () => {
    fetchAgentDetailMock.mockRejectedValue(axiosErrorNoResponse());

    renderAgentRoute();

    // ErrorView's NETWORK-bucket body — its presence proves the layout's own
    // boundary caught the Header throw at THIS level. `InnerErrorFallback`
    // never renders this string.
    await screen.findByText("Check your connection and try again.");
    // `InnerErrorFallback`'s body must be ABSENT — pre-fix the throw bubbles
    // past this layout to AppShell's boundary and this string renders instead.
    expect(
      screen.queryByText(
        "An unexpected error occurred while rendering this section.",
      ),
    ).not.toBeInTheDocument();
  });

  it("refetches agent detail when 'Try again' is clicked (onReset wiring)", async () => {
    fetchAgentDetailMock.mockRejectedValue(axiosErrorNoResponse());

    renderAgentRoute();

    const retry = await screen.findByRole("button", { name: "Try again" });
    // `@sico/app` doesn't depend on `@testing-library/user-event`; a bare
    // button click has no focus/keydown chain, so `fireEvent` is sufficient.
    const before = fetchAgentDetailMock.mock.calls.length;
    fireEvent.click(retry);

    // `onReset={reset}` clears the cached query error so the suspense query
    // refetches on remount rather than re-throwing the stale error.
    await waitFor(() => {
      expect(fetchAgentDetailMock.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("auto-clears the stale fallback when navigating to a healthy agent (resetKeys)", async () => {
    // Agent 7's detail fetch throws; agent 9's resolves. The boundary is
    // REUSED across the param switch, so without `resetKeys={[agentId]}` it
    // stays stuck on agent 7's fallback until a manual "Try again".
    fetchAgentDetailMock.mockImplementation(
      (_apiClient: AxiosInstance, agentId: number) =>
        agentId === 9
          ? Promise.resolve({
              id: 9,
              name: "Healthy Agent",
              status: AgentStatusSchema.enum.ACTIVE,
            })
          : Promise.reject(axiosErrorNoResponse()),
    );

    const { router } = renderAgentRoute();

    // Agent 7 fails → the layout's own boundary shows ErrorView here.
    await screen.findByText("Check your connection and try again.");

    await act(async () => {
      await router.navigate({
        to: "/digital-worker/$agentId",
        params: { agentId: "9" },
      });
    });

    // resetKeys keyed on agentId clears the boundary on the 7→9 switch, so
    // agent 9's header renders and the stale fallback is gone — no manual retry.
    // The bare index path lands on the DigitalWorkerHome, whose hero ALSO renders
    // the agent name — hence findAllByText (name appears in both the Header and
    // the home hero).
    await screen.findAllByText("Healthy Agent");
    expect(
      screen.queryByText("Check your connection and try again."),
    ).not.toBeInTheDocument();
  });
});
