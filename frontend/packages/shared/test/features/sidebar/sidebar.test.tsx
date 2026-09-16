import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import { type ReactElement, type ReactNode, useId } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { AgentStatusSchema } from "@/features/digital-worker/schemas/agent";
import {
  sidebarCollapsedAtom,
  sidebarForcedCollapsedAtom,
} from "@/features/sidebar/atoms/sidebar-atom";
import { ApiClientProvider } from "@/services/api-client-context";

// --- Mocks --------------------------------------------------------------
const mockUseLocation = vi.fn();
const mockUseMatches = vi.fn();
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    className,
    "aria-current": ariaCurrent,
    "aria-label": ariaLabel,
    "data-active": dataActive,
    "data-testid": dataTestid,
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
    className?: string;
    "aria-current"?: "page";
    "aria-label"?: string;
    "data-active"?: boolean;
    "data-testid"?: string;
  }): ReactElement => (
    <a
      href={to}
      data-to={to}
      className={className}
      aria-current={ariaCurrent}
      aria-label={ariaLabel}
      data-active={dataActive ? "" : undefined}
      data-params={params ? JSON.stringify(params) : undefined}
      data-testid={dataTestid}
    >
      {children}
    </a>
  ),
  useLocation: () => mockUseLocation(),
  useMatches: () => mockUseMatches(),
  useNavigate: () => mockNavigate,
}));

const mockUseAgentsQuery = vi.fn();
const mockUseAgentQuery = vi.fn();
vi.mock("@/features/digital-worker/hooks/use-agents-query", () => ({
  useAgentQuery: (...args: unknown[]) => mockUseAgentQuery(...args),
  useAgentsQuery: (opts: unknown) => mockUseAgentsQuery(opts),
  AGENTS_QUERY_KEY_PREFIX: ["agents"] as const,
  // DwConversationNav reads the DW identity via this options factory + a
  // (mocked) useSuspenseQuery; the returned object only needs a stable queryKey.
  agentQueryOptions: (agentId: number) => ({
    queryKey: ["agents", "detail", agentId] as const,
  }),
}));

const mockUseOrganizationPermission = vi.fn();
vi.mock("@/features/rbac/hooks/use-organization-permission", () => ({
  useOrganizationPermission: () => mockUseOrganizationPermission(),
}));

const mockUseUserOrganizationsQuery = vi.fn();
const mockUseBoundOrganizationQuery = vi.fn();
vi.mock("@/features/organization/hooks/use-organization-query", () => ({
  useUserOrganizationsQuery: () => mockUseUserOrganizationsQuery(),
}));
vi.mock("@/hooks/use-bound-organization", () => ({
  useBoundOrganizationQuery: () => mockUseBoundOrganizationQuery(),
}));

const mockUseLogout = vi.fn();
vi.mock("@/features/rbac-login/hooks/use-logout", () => ({
  useLogout: () => mockUseLogout(),
}));

// Conversation-mode hooks (DwConversationNav): mocked so that, inside a DW
// (`/digital-worker/$id`), the sidebar renders conversation mode without a real
// QueryClient. The agent detail feeds the title row; the list feeds the
// conversation rows.
const mockUseConversations = vi.fn();
vi.mock("@/features/chat/hooks/use-conversations", () => ({
  useConversations: (agentInstanceId: number) =>
    mockUseConversations(agentInstanceId),
}));

// Title polling is a pure side effect with its own dedicated test; stub it so
// these Sidebar render tests don't drive real useQueries polling.
vi.mock("@/features/chat/hooks/use-pending-conversation-titles", () => ({
  usePendingConversationTitles: () => {},
}));

// The hook returns a flattened item list plus infinite-scroll controls; these
// tests only vary `items`, so wrap them with inert paging fields.
function convResult(
  items: readonly { id: number; title: string; agentInstanceId?: number }[],
): {
  items: readonly { id: number; title: string; agentInstanceId?: number }[];
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
} {
  return {
    items,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  };
}

vi.mock("@tanstack/react-query", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useSuspenseQuery: () => ({
      data: { id: 1, name: "Alpha", role: "Tester", iconUri: "" },
    }),
  };
});

// The sidebar now renders `NotificationNavItem` inline, which drives
// `useNotifications` (react-query `useQuery`/`useMutation`). These sidebar
// tests don't exercise notifications, so stub the hook with an inert empty
// state — avoids needing a real QueryClientProvider around every render.
vi.mock("@/features/notifications/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

// Import after mocks so vi.mock registrations apply. `useActiveNav` is NOT
// mocked — it's pure over `useLocation` (mocked above), so tests drive
// active state by setting the pathname.
const { Sidebar } = await import("@/features/sidebar/components/sidebar");
const { SidebarAccountMenu } =
  await import("@/features/sidebar/components/sidebar-account-menu");

// --- Helpers ------------------------------------------------------------
const apiClient = {} as AxiosInstance;
const fakeUser = {
  id: 1,
  email: "me@sico.ai",
  roles: [],
};

function withStore(
  ui: ReactElement,
  opts?: {
    collapsed?: boolean;
    forced?: boolean;
    mode?: "operator" | "developer";
  },
): ReactElement {
  const store = createStore();
  store.set(userAtom, fakeUser);
  if (opts?.mode) {
    mockUseLocation.mockReturnValue({
      pathname: opts.mode === "developer" ? "/studio" : "/digital-worker",
    });
    mockUseMatches.mockReturnValue([
      { staticData: { workspaceMode: opts.mode } },
    ]);
  }
  if (opts?.collapsed) {
    store.set(sidebarCollapsedAtom, true);
  }
  if (opts?.forced) {
    store.set(sidebarForcedCollapsedAtom, true);
  }
  return (
    <Provider store={store}>
      <ApiClientProvider client={apiClient}>{ui}</ApiClientProvider>
    </Provider>
  );
}

function page(
  items: { id: number; name: string; role?: string; iconUri?: string }[],
): {
  items: { id: number; name: string; role?: string; iconUri?: string }[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
} {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 50,
    hasNext: false,
  };
}

const logoutMutate = vi.fn();

beforeEach(() => {
  mockUseLocation.mockReturnValue({ pathname: "/" });
  mockUseMatches.mockReturnValue([]);
  const organization = { id: 1, name: "SICO" };
  mockUseUserOrganizationsQuery.mockReturnValue({
    data: [organization],
    isPending: false,
    isError: false,
  });
  mockUseBoundOrganizationQuery.mockReturnValue({
    data: organization,
    isPending: false,
    isError: false,
  });
  mockUseOrganizationPermission.mockReturnValue({
    canEnterStudio: true,
    canRenameOrganization: true,
    canManageOrganizationMembers: true,
    canManageOrganizationDevices: true,
    canManage: true,
    currentUserId: 1,
    isPending: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseLogout.mockReturnValue({ mutate: logoutMutate, isPending: false });
  mockUseAgentQuery.mockReturnValue({
    data: { id: 1, name: "Arena", status: 3 },
  });
  mockUseAgentsQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: { pages: [page([{ id: 1, name: "Arena" }])], pageParams: [1] },
  });
  mockUseConversations.mockReturnValue(convResult([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

// jsdom has no IntersectionObserver; conversation mode mounts an infinite-scroll
// sentinel. A no-op stub is enough — these tests don't drive pagination.
beforeAll(() => {
  class NoopIO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(global, "IntersectionObserver", {
    writable: true,
    configurable: true,
    value: NoopIO,
  });
});

// --- Tests --------------------------------------------------------------

describe("<Sidebar> landmark + structure", () => {
  it("renders nav landmark with 'Primary navigation' label", () => {
    render(withStore(<Sidebar />));
    screen.getByRole("navigation", { name: "Primary navigation" });
  });

  it("renders Logo in expanded state (top bar is absent when collapsed)", () => {
    const { rerender } = render(withStore(<Sidebar />));
    screen.getByTestId("sidebar-logo");
    rerender(withStore(<Sidebar />, { collapsed: true }));
    expect(screen.queryByTestId("sidebar-logo")).not.toBeInTheDocument();
  });

  it("nav order: Projects comes before the Digital Workers group", () => {
    render(withStore(<Sidebar />));
    const links = screen.getAllByRole("link");
    const dwIdx = links.findIndex(
      (l) => l.getAttribute("data-to") === "/digital-worker",
    );
    const projIdx = links.findIndex(
      (l) => l.getAttribute("data-to") === "/project",
    );
    expect(projIdx).toBeGreaterThanOrEqual(0);
    expect(dwIdx).toBeGreaterThan(projIdx);
  });
});

describe("<Sidebar> developer mode", () => {
  it("expanded: places one Notifications control before Studio", () => {
    render(withStore(<Sidebar />, { mode: "developer" }));
    const list = screen.getByTestId("sidebar-nav-list");
    const notificationName = /^Notifications(?:, \d+ unread)?$/;
    expect(
      within(list).getAllByRole("button", { name: notificationName }),
    ).toHaveLength(1);
    const notification = within(list).getByRole("button", {
      name: notificationName,
    });
    const studio = within(list).getByRole("link", { name: "Studio" });

    expect(notification.compareDocumentPosition(studio)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("collapsed: places one Notifications control before Studio", () => {
    render(withStore(<Sidebar />, { mode: "developer", collapsed: true }));
    const rail = screen.getByTestId("sidebar-rail");
    const notificationName = /^Notifications(?:, \d+ unread)?$/;
    expect(
      within(rail).getAllByRole("button", { name: notificationName }),
    ).toHaveLength(1);
    const notification = within(rail).getByRole("button", {
      name: notificationName,
    });
    const studio = within(rail).getByRole("link", { name: "Studio" });

    expect(notification.compareDocumentPosition(studio)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("expanded: renders a single Studio nav item, no Digital Workers or Projects", () => {
    render(withStore(<Sidebar />, { mode: "developer" }));
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("data-to") === "/studio/all")).toBe(
      true,
    );
    expect(
      links.some((l) => l.getAttribute("data-to") === "/digital-worker"),
    ).toBe(false);
    expect(links.some((l) => l.getAttribute("data-to") === "/project")).toBe(
      false,
    );
  });

  it("collapsed: renders the Studio rail item, no Digital Workers or Projects", () => {
    render(withStore(<Sidebar />, { mode: "developer", collapsed: true }));
    const rail = screen.getByTestId("sidebar-rail");
    const links = within(rail).getAllByRole("link");
    expect(links.some((l) => l.getAttribute("data-to") === "/studio/all")).toBe(
      true,
    );
    expect(
      links.some((l) => l.getAttribute("data-to") === "/digital-worker"),
    ).toBe(false);
    expect(links.some((l) => l.getAttribute("data-to") === "/project")).toBe(
      false,
    );
  });

  it("operator mode still renders Digital Workers + Projects", () => {
    render(withStore(<Sidebar />, { mode: "operator" }));
    const links = screen.getAllByRole("link");
    expect(
      links.some((l) => l.getAttribute("data-to") === "/digital-worker"),
    ).toBe(true);
    expect(links.some((l) => l.getAttribute("data-to") === "/studio/all")).toBe(
      false,
    );
  });

  it("expanded: logo is SICO.Dev in developer mode, SICO in operator mode", () => {
    const { rerender } = render(withStore(<Sidebar />, { mode: "developer" }));
    expect(
      within(screen.getByTestId("sidebar-logo")).getByAltText("SICO.Dev"),
    ).toBeInTheDocument();
    rerender(withStore(<Sidebar />, { mode: "operator" }));
    expect(
      within(screen.getByTestId("sidebar-logo")).getByAltText("SICO"),
    ).toBeInTheDocument();
  });
});

describe("<Sidebar> top bar (T-B1)", () => {
  it("expanded: toggle visible with label 'Collapse sidebar'", () => {
    render(withStore(<Sidebar />));
    screen.getByRole("button", { name: "Collapse sidebar" });
  });

  it("expanded: no Notification bell or '99+' badge (R3 scope correction)", () => {
    render(withStore(<Sidebar />));
    expect(
      screen.queryByRole("button", { name: "Notification" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("99+")).not.toBeInTheDocument();
  });

  it("collapsed: top bar is absent — no Collapse-sidebar toggle (Expand-sidebar is in rail per T-B2)", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    expect(
      screen.queryByRole("button", { name: "Collapse sidebar" }),
    ).not.toBeInTheDocument();
  });
});

// Integration: the chat Sidepane force-collapses the sidebar via the transient
// `sidebarForcedCollapsedAtom` (it takes ~75% of the row). These assert the
// COMPONENT honours the effective-collapsed atom, not just the atom layer —
// `sidebarEffectiveCollapsedAtom` = persisted pref OR transient force. A manual
// expand stays available while forced: it clears BOTH atoms so the user can
// re-open the rail even with the Sidepane up.
describe("<Sidebar> Sidepane force-collapse (effective state)", () => {
  it("force-collapsed: renders the collapsed rail with a working expand control", () => {
    // forced only (persisted pref stays expanded) → effective is collapsed.
    render(withStore(<Sidebar />, { forced: true }));
    // The collapsed rail is shown, with no expanded collapse toggle…
    screen.getByTestId("sidebar-rail");
    expect(
      screen.queryByRole("button", { name: "Collapse sidebar" }),
    ).not.toBeInTheDocument();
    // …but the rail's Expand control is still offered (not a dead button).
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeInTheDocument();
  });

  it("force-collapsed: clicking Expand clears the force so the rail opens", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.set(userAtom, fakeUser);
    store.set(sidebarForcedCollapsedAtom, true);
    render(
      <Provider store={store}>
        <ApiClientProvider client={apiClient}>
          <Sidebar />
        </ApiClientProvider>
      </Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    // Expand must win over the Sidepane force: both atoms clear → effective
    // expanded → the expanded Collapse toggle is now shown.
    expect(store.get(sidebarForcedCollapsedAtom)).toBe(false);
    screen.getByRole("button", { name: "Collapse sidebar" });
  });

  it("not forced and pref expanded: renders the expanded sidebar", () => {
    render(withStore(<Sidebar />));
    screen.getByRole("button", { name: "Collapse sidebar" });
  });
});

describe("<Sidebar> active highlight", () => {
  it("useActiveNav='dw' → the 'all' link is a plain affordance, not marked active (highlight lives on the DW rows)", () => {
    mockUseLocation.mockReturnValue({ pathname: "/digital-worker" });
    render(withStore(<Sidebar />));
    const dw = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    const proj = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/project");
    // The DW group header is now a caplabel + "all" link (DwSection); the active
    // state moved onto the individual DW rows (DwList), so the "all" link itself
    // carries no aria-current/data-active.
    expect(dw).not.toHaveAttribute("aria-current");
    expect(dw).not.toHaveAttribute("data-active");
    expect(proj).not.toHaveAttribute("aria-current");
  });
});

describe("<Sidebar> mutex active state (R11)", () => {
  it("/digital-worker (list index) → neither the 'all' link nor any DW row is active", () => {
    mockUseLocation.mockReturnValue({ pathname: "/digital-worker" });
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [page([{ id: 1, name: "Alpha" }])],
        pageParams: [1],
      },
    });
    render(withStore(<Sidebar />));
    const allLink = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    const row = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker/$agentId");
    // The list index selects no specific agent, so the row is inactive; the
    // "all" link is a plain caplabel affordance that never carries active state.
    expect(allLink).not.toHaveAttribute("data-active");
    expect(row).not.toHaveAttribute("data-active");
  });

  it("/digital-worker/$id → conversation mode replaces the DW list (no Projects/header rows)", () => {
    mockUseLocation.mockReturnValue({ pathname: "/digital-worker/1" });
    mockUseConversations.mockReturnValue(
      convResult([{ id: 55, title: "First chat", agentInstanceId: 1 }]),
    );
    render(withStore(<Sidebar />));
    // Conversation mode takes over the menu: the standard nav (Digital Workers
    // header + Projects) is gone, replaced by a back link + the conversation
    // row.
    const links = screen.getAllByRole("link");
    expect(
      links.find((l) => l.getAttribute("data-to") === "/project"),
    ).toBeUndefined();
    expect(
      links.find(
        (l) =>
          l.getAttribute("data-to") ===
          "/digital-worker/$agentId/collaboration/$conversationId",
      ),
    ).toBeDefined();
  });

  it("collapsed inactive conversation mode renders a disabled New session Button", () => {
    mockUseLocation.mockReturnValue({ pathname: "/digital-worker/1" });
    mockUseAgentQuery.mockReturnValue({
      data: { id: 1, name: "Arena", status: AgentStatusSchema.enum.INACTIVE },
    });

    render(withStore(<Sidebar />, { collapsed: true }));

    const newSession = screen.getByRole("button", { name: "New session" });
    expect(newSession).toBeDisabled();
    expect(newSession).toHaveAttribute("data-slot", "button");
    expect(newSession).toHaveClass(
      "disabled:bg-button-subtle-fill-disabled",
      "disabled:text-button-subtle-foreground-disabled",
      "disabled:pointer-events-none",
    );
  });
});

describe("<Sidebar> DW list states (§4)", () => {
  it("loading: renders DwSkeleton", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    });
    render(withStore(<Sidebar />));
    expect(screen.getAllByTestId("dw-skeleton-row").length).toBeGreaterThan(0);
  });

  it("empty: renders 'No agents yet'", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [page([])], pageParams: [1] },
    });
    render(withStore(<Sidebar />));
    expect(screen.getByText("No agents yet")).toBeVisible();
  });

  it("error: fallback renders 'Couldn't load agents' with NO retry button", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    });
    render(withStore(<Sidebar />));
    expect(screen.getByText("Couldn't load agents")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /retry|reload/i }),
    ).not.toBeInTheDocument();
  });

  it("DW list slice: 200 agents → only 5 rows", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1,
      name: `Agent ${String(i + 1)}`,
    }));
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [page(many)], pageParams: [1] },
    });
    render(withStore(<Sidebar />));
    const dwRowLinks = screen
      .getAllByRole("link")
      .filter((l) =>
        (l.getAttribute("data-to") ?? "").startsWith("/digital-worker/$"),
      );
    expect(dwRowLinks).toHaveLength(5);
  });

  it("DW row link uses TanStack params: to='/dw/$agentId', params.agentId", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [page([{ id: 42, name: "Arena" }])],
        pageParams: [1],
      },
    });
    render(withStore(<Sidebar />));
    const row = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker/$agentId");
    expect(row).toBeDefined();
    expect(row?.getAttribute("data-params")).toBe(
      JSON.stringify({ agentId: "42" }),
    );
  });
});

describe("<Sidebar> footer", () => {
  it("renders user email label without title attr (R5: drop native tooltip)", () => {
    render(withStore(<Sidebar />));
    const label = screen.getByText("me@sico.ai");
    expect(label).not.toHaveAttribute("title");
  });

  it("footer avatar has no click handler", () => {
    render(withStore(<Sidebar />));
    const avatar = screen.getByTestId("sidebar-user-avatar");
    expect(avatar).not.toHaveAttribute("onclick");
    // Avatar is a span/div, not a button
    expect(avatar.tagName.toLowerCase()).not.toBe("button");
  });
});

describe("<Sidebar> footer (T-B4 — Figma pill)", () => {
  it("expanded: pill contains avatar, email label, and a visible account menu button", () => {
    render(withStore(<Sidebar />));
    screen.getByTestId("sidebar-user-avatar");
    expect(screen.getByText("me@sico.ai")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Account options" }),
    ).toBeVisible();
  });

  it("expanded: hides both access items when the bound organization is unavailable", async () => {
    mockUseOrganizationPermission.mockReturnValue({
      canEnterStudio: false,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
      currentUserId: 1,
      isPending: true,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(withStore(<Sidebar />));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      screen.queryByRole("menuitem", { name: "Manage Organization" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Go to SICO.Dev" }),
    ).toBeNull();
    expect(
      await screen.findByRole("menuitem", { name: "Language" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  });

  it("expanded: hides both access items when RBAC fails", async () => {
    mockUseOrganizationPermission.mockReturnValue({
      canEnterStudio: false,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
      currentUserId: 1,
      isPending: false,
      isLoading: false,
      isError: true,
      error: new Error("Permission request failed"),
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(withStore(<Sidebar />));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Manage Organization" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Go to SICO.Dev" }),
    ).toBeNull();
    expect(
      await screen.findByRole("menuitem", { name: "Language" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  });

  it("expanded: hides organization management from ordinary members", async () => {
    mockUseOrganizationPermission.mockReturnValue({
      canEnterStudio: false,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
      currentUserId: 1,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(withStore(<Sidebar />));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      screen.queryByRole("menuitem", { name: "Manage Organization" }),
    ).toBeNull();
  });

  it("expanded: gates organization management on the aggregate capability", async () => {
    mockUseOrganizationPermission.mockReturnValue({
      canEnterStudio: false,
      canRenameOrganization: true,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
      currentUserId: 1,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(withStore(<Sidebar />));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      screen.queryByRole("menuitem", { name: "Manage Organization" }),
    ).toBeNull();
  });

  it("expanded: shows Studio but hides organization management from developers", async () => {
    mockUseOrganizationPermission.mockReturnValue({
      canEnterStudio: true,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
      currentUserId: 1,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(withStore(<Sidebar />, { mode: "operator" }));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      screen.queryByRole("menuitem", { name: "Manage Organization" }),
    ).toBeNull();
    expect(
      await screen.findByRole("menuitem", { name: "Go to SICO.Dev" }),
    ).toBeVisible();
  });

  it("expanded: shows both access items for a matching administrator", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />, { mode: "operator" }));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      await screen.findByRole("menuitem", { name: "Manage Organization" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Go to SICO.Dev" }),
    ).toBeVisible();
  });

  it("expanded: account menu button opens a menu with a Log out item", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));
    expect(
      await screen.findByRole("menuitem", { name: "Log out" }),
    ).toBeVisible();
  });

  it("expanded: account menu shows Language above Log out", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));

    const items = await screen.findAllByRole("menuitem");
    const names = items.map((item) => item.textContent);

    expect(names.indexOf("Language")).toBeLessThan(names.indexOf("Log out"));
  });

  it("expanded: account menu follows the Figma item order", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Switch Organization",
      "Manage Organization",
      "Go to SICO.Dev",
      "Language",
      "Log out",
    ]);
  });

  it("expanded: places the organization divider after management", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));

    const manage = await screen.findByRole("menuitem", {
      name: "Manage Organization",
    });
    expect(manage.nextElementSibling).toHaveAttribute("role", "separator");
  });

  it("expanded: account menu uses the Figma width", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(await screen.findByRole("menu")).toHaveClass("w-49");
  });

  it("expanded: Go to SICO.Dev replace-navigates to Studio", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Go to SICO.Dev" }),
    );

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/studio/all",
      replace: true,
    });
  });

  it("account menu uses one unified permission hook site across rerenders", () => {
    const hookSites = new Set<string>();
    mockUseOrganizationPermission.mockImplementation(() => {
      hookSites.add(useId());
      return {
        canEnterStudio: true,
        canRenameOrganization: true,
        canManageOrganizationMembers: true,
        canManageOrganizationDevices: true,
        canManage: true,
        currentUserId: 1,
        isPending: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    });
    const { rerender } = render(
      withStore(<SidebarAccountMenu />, { mode: "developer" }),
    );

    rerender(withStore(<SidebarAccountMenu />, { mode: "developer" }));

    expect(hookSites.size).toBe(1);
  });

  it("expanded: Studio mode shows both items", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />, { mode: "developer" }));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      await screen.findByRole("menuitem", { name: "Manage Organization" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Go to SICO" })).toBeVisible();
  });

  it("expanded: Studio mode hides Manage Organization without an organization", async () => {
    mockUseOrganizationPermission.mockReturnValue({
      canEnterStudio: false,
      canRenameOrganization: false,
      canManageOrganizationMembers: false,
      canManageOrganizationDevices: false,
      canManage: false,
      currentUserId: 1,
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    render(withStore(<Sidebar />, { mode: "developer" }));

    await user.click(screen.getByRole("button", { name: "Account options" }));

    expect(
      screen.queryByRole("menuitem", { name: "Manage Organization" }),
    ).toBeNull();
    expect(
      await screen.findByRole("menuitem", { name: "Go to SICO" }),
    ).toBeVisible();
  });

  it("expanded: Go to SICO replace-navigates to the workspace", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />, { mode: "developer" }));
    await user.click(screen.getByRole("button", { name: "Account options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Go to SICO" }),
    );

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/digital-worker",
      replace: true,
    });
  });

  it("expanded: Manage Organization navigates to the management route", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Manage Organization" }),
    );

    expect(mockNavigate).toHaveBeenCalledWith({ to: "/organization" });
  });

  it("expanded: Log out uses destructive styling and an icon", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));

    const logoutItem = await screen.findByRole("menuitem", { name: "Log out" });
    expect(logoutItem).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByTestId("sidebar-logout-icon")).toHaveClass("size-3");
  });

  it("expanded: choosing Log out from the menu calls logout.mutate", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Log out" }));
    expect(logoutMutate).toHaveBeenCalledTimes(1);
  });

  it("collapsed: avatar is present and no account menu button is rendered", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    screen.getByTestId("sidebar-user-avatar");
    expect(
      screen.queryByRole("button", { name: "Account options" }),
    ).not.toBeInTheDocument();
  });
});

describe("<Sidebar> DW error", () => {
  it("renders fallback when DW query is in error state", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    });
    render(withStore(<Sidebar />));
    // Nav landmark + footer still intact, DW area shows fallback text.
    screen.getByRole("navigation", { name: "Primary navigation" });
    screen.getByTestId("sidebar-dw-error-boundary");
  });
});

describe("<Sidebar> collapsed rail (T-B2)", () => {
  it("collapsed: rail container is rendered", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    screen.getByTestId("sidebar-rail");
  });

  // Round-1 fix loop (C2): Figma collapsed rail = 44px (`w-11`).
  // Browser screenshot at devicePixelRatio < 1 can downscale to ~36px;
  // Playwright DOM bounding box confirms 44px at viewport 1440x900.
  // Assert the class contract here so jsdom-level regressions are caught.
  it("collapsed: nav has w-11 (44px) and shrink-0 class contract", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(nav).toHaveClass("data-[collapsed]:w-11");
    expect(nav).toHaveClass("shrink-0");
    expect(nav.getAttribute("data-collapsed")).toBe("true");
  });

  it("collapsed: logo mark is a button labeled 'Expand sidebar' and click expands", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.set(userAtom, fakeUser);
    store.set(sidebarCollapsedAtom, true);
    render(
      <Provider store={store}>
        <ApiClientProvider client={apiClient}>
          <Sidebar />
        </ApiClientProvider>
      </Provider>,
    );
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    await user.click(expand);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });

  it("collapsed: rail contains person/DW and projects only (R3 scope correction — no bell, my-team, divider)", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    const rail = screen.getByTestId("sidebar-rail");
    expect(
      screen.queryByRole("button", { name: "Notification" }),
    ).not.toBeInTheDocument();
    const railLinks = within(rail).getAllByRole("link");
    expect(
      railLinks.some((l) => l.getAttribute("data-to") === "/digital-worker"),
    ).toBe(true);
    expect(
      railLinks.some((l) => l.getAttribute("data-to") === "/project"),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "My team" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-rail-divider")).toBeNull();
  });

  it("collapsed: DwList region is not rendered", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    expect(
      screen.queryByLabelText("Digital Workers list"),
    ).not.toBeInTheDocument();
  });

  it("collapsed: first agent avatar appears in rail when query has data", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [page([{ id: 7, name: "Zephyr" }])],
        pageParams: [1],
      },
    });
    render(withStore(<Sidebar />, { collapsed: true }));
    screen.getByTestId("sidebar-rail-current-dw");
  });

  it("collapsed: current DW avatar omitted when agent list is empty", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: { pages: [page([])], pageParams: [1] },
    });
    render(withStore(<Sidebar />, { collapsed: true }));
    expect(
      screen.queryByTestId("sidebar-rail-current-dw"),
    ).not.toBeInTheDocument();
  });

  it("expanded: rail-only controls (Expand sidebar) are absent", () => {
    render(withStore(<Sidebar />));
    expect(screen.queryByTestId("sidebar-rail")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand sidebar" }),
    ).not.toBeInTheDocument();
  });
});

describe("<Sidebar> expanded nav structure (T-B3)", () => {
  it("renders the Digital Workers group caplabel with an 'all' Link to /dw", () => {
    render(withStore(<Sidebar />));
    // New DwSection: a static "Digital workers" caplabel (a span, not a link)
    // plus a separate "all" affordance that links to the full list. Sentence
    // case at the source; CSS `uppercase` renders it all-caps.
    expect(screen.getByText("Digital Workers")).toBeInTheDocument();
    const allLink = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    expect(allLink).toBeDefined();
    expect(allLink).toHaveAttribute("aria-label", "View all digital workers");
  });

  it("renders Notification and Projects above the DW group, in that order", () => {
    render(withStore(<Sidebar />));
    const indent = screen.getByTestId("dw-list-container");
    const list = screen.getByTestId("sidebar-nav-list");
    const links = within(list).getAllByRole("link");
    const dwHeader = links.find(
      (l) => l.getAttribute("data-to") === "/digital-worker",
    ) as HTMLElement;
    const projects = links.find(
      (l) => l.getAttribute("data-to") === "/project",
    ) as HTMLElement;
    expect(dwHeader).not.toBeUndefined();
    expect(indent).toBeVisible();
    expect(projects).not.toBeUndefined();
    // Notification is now a built-in nav row (not a downstream injection),
    // rendered as a popover trigger at the top of the menu.
    const notification = within(list)
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-label")?.startsWith("Notifications"));
    if (!notification) {
      throw new Error("expected a Notifications nav row");
    }
    // DOM order: notification < projects < dwHeader < indent.
    const follows = (a: Node, b: Node): boolean =>
      Boolean(
        // eslint-disable-next-line no-bitwise -- Node.compareDocumentPosition returns a bitmask
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(follows(notification, projects)).toBe(true);
    expect(follows(projects, dwHeader)).toBe(true);
    expect(follows(dwHeader, indent)).toBe(true);
  });

  it("when useActiveNav='dw' the 'all' link carries no aria-current/data-active — the old header-highlight rule (R10) is gone", () => {
    mockUseLocation.mockReturnValue({ pathname: "/digital-worker" });
    render(withStore(<Sidebar />));
    const dw = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    // DwSection's "all" link is a navigation affordance, not a selected state:
    // the active highlight now lives on the DW rows (DwList), never the header.
    expect(dw).not.toHaveAttribute("aria-current");
    expect(dw).not.toHaveAttribute("data-active");
  });

  it("C1: conversation row matching the active /$conversationId gets data-active; siblings stay rest", () => {
    mockUseLocation.mockReturnValue({
      pathname: "/digital-worker/2/collaboration/88",
    });
    mockUseConversations.mockReturnValue(
      convResult([
        { id: 77, title: "First", agentInstanceId: 2 },
        { id: 88, title: "Second", agentInstanceId: 2 },
      ]),
    );
    render(withStore(<Sidebar />));
    const rows = screen
      .getAllByRole("link")
      .filter(
        (l) =>
          l.getAttribute("data-to") ===
          "/digital-worker/$agentId/collaboration/$conversationId",
      );
    const first = rows.find(
      (r) =>
        r.getAttribute("data-params") ===
        JSON.stringify({ agentId: "2", conversationId: "77" }),
    );
    const second = rows.find(
      (r) =>
        r.getAttribute("data-params") ===
        JSON.stringify({ agentId: "2", conversationId: "88" }),
    );
    expect(second).toHaveAttribute("data-active");
    expect(first).not.toHaveAttribute("data-active");
  });

  it("DwList is rendered inside the list container (dw-list-container)", () => {
    render(withStore(<Sidebar />));
    const indent = screen.getByTestId("dw-list-container");
    // First agent row link should live inside the list container.
    const inner = within(indent)
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker/$agentId");
    expect(inner).not.toBeUndefined();
  });
});

describe("<Sidebar> round-2 figma audit fixes (#18-#24)", () => {
  it("C3: pending query renders a current-DW skeleton placeholder in the rail", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    });
    render(withStore(<Sidebar />, { collapsed: true }));
    expect(
      screen.getAllByTestId("sidebar-rail-current-dw-skeleton").length,
    ).toBeGreaterThan(0);
  });

  it("I1+I4: user (human) AvatarFallback renders with an inline background color from the palette", () => {
    render(withStore(<Sidebar />));
    const userAvatar = screen.getByTestId("sidebar-user-avatar");
    const fallback = within(userAvatar).getByTestId("avatar-fallback");
    expect(fallback.style.backgroundColor).not.toBe("");
  });

  it("I3: collapsed rail no longer renders bell (R3 scope correction)", () => {
    render(withStore(<Sidebar />, { collapsed: true }));
    expect(
      screen.queryByRole("button", { name: "Notification" }),
    ).not.toBeInTheDocument();
  });

  it("I5: NotificationBadge no longer rendered (R3 scope correction)", () => {
    render(withStore(<Sidebar />));
    expect(screen.queryByText("99+")).not.toBeInTheDocument();
  });

  it("Gap A: DW row renders <img> with src={iconUri} when iconUri present", () => {
    // Base UI's AvatarImage only mounts <img> once the image fires `load`.
    // In jsdom we stub window.Image so the load handler runs synchronously.
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 1;
      complete = true;
      set src(_: string) {
        // No-op: `complete=true` triggers Base UI's fast-path to 'loaded'.
      }
    }
    const originalImage = window.Image;
    // @ts-expect-error -- jsdom stub for Base UI AvatarImage fast-path
    window.Image = StubImage;
    try {
      mockUseAgentsQuery.mockReturnValue({
        isPending: false,
        isError: false,
        data: {
          pages: [
            page([
              {
                id: 9,
                name: "Arena",
                iconUri: "/storage/1/abc.svg",
              },
            ]),
          ],
          pageParams: [1],
        },
      });
      render(withStore(<Sidebar />));
      const row = screen
        .getAllByRole("link")
        .find((l) => l.getAttribute("data-to") === "/digital-worker/$agentId")!;
      const img = within(row).getByTestId("avatar-image");
      expect(img.getAttribute("src")).toBe("/storage/1/abc.svg");
    } finally {
      window.Image = originalImage;
    }
  });

  it("Gap B: DW row label is 'name, role' when role provided", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [page([{ id: 1, name: "Arena", role: "Legal Counsel" }])],
        pageParams: [1],
      },
    });
    render(withStore(<Sidebar />));
    expect(screen.getByText("Arena, Legal Counsel")).toBeVisible();
  });

  it("Gap B: DW row label is name only when role missing", () => {
    mockUseAgentsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        pages: [page([{ id: 1, name: "Arena" }])],
        pageParams: [1],
      },
    });
    render(withStore(<Sidebar />));
    expect(screen.getByText("Arena")).toBeVisible();
    expect(screen.queryByText(/Arena,/)).not.toBeInTheDocument();
  });
});

describe("<Sidebar> Projects link target (Task 15)", () => {
  it("renders the Projects nav item linking to /project", () => {
    render(withStore(<Sidebar />));
    const projects = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/project");
    expect(projects).toBeDefined();
    expect(projects?.textContent).toContain("Projects");
    expect(projects?.getAttribute("href")).toBe("/project");
  });
});

describe("<Sidebar> source quality (AC-3, MI-DS-01/12)", () => {
  it("contains no raw hex literals or px literals", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../../src/features/sidebar/components/sidebar.tsx",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(source).not.toMatch(/\b\d+px\b/);
  });
});
