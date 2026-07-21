import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import type { ReactElement, ReactNode } from "react";
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
import { userModeAtom } from "@/atoms/user-mode-atom";
import {
  sidebarCollapsedAtom,
  sidebarForcedCollapsedAtom,
} from "@/features/sidebar/atoms/sidebar-atom";
import { type NavItemData } from "@/features/sidebar/types";
import { ApiClientProvider } from "@/services/api-client-context";

// --- Mocks --------------------------------------------------------------
const mockUseLocation = vi.fn();
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
}));

const mockUseAgentsQuery = vi.fn();
vi.mock("@/features/digital-worker/hooks/use-agents-query", () => ({
  useAgentsQuery: (opts: unknown) => mockUseAgentsQuery(opts),
  AGENTS_QUERY_KEY_PREFIX: ["agents"] as const,
  // DwConversationNav reads the DW identity via this options factory + a
  // (mocked) useSuspenseQuery; the returned object only needs a stable queryKey.
  agentQueryOptions: (agentId: number) => ({
    queryKey: ["agents", "detail", agentId] as const,
  }),
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

// Import after mocks so vi.mock registrations apply. `useActiveNav` is NOT
// mocked — it's pure over `useLocation` (mocked above), so tests drive
// active state by setting the pathname.
const { Sidebar } = await import("@/features/sidebar/components/sidebar");

// --- Helpers ------------------------------------------------------------
const apiClient = {} as AxiosInstance;
const fakeUser = {
  id: 1,
  email: "me@sico.ai",
  roles: [] as {
    id: number;
    roleCode: string;
    scopeType: string;
    scopeId: number;
  }[],
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
    store.set(userModeAtom, opts.mode);
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
  mockUseLogout.mockReturnValue({ mutate: logoutMutate, isPending: false });
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
  it("expanded: renders a single Studio nav item, no Digital Workers or Projects", () => {
    render(withStore(<Sidebar />, { mode: "developer" }));
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("data-to") === "/studio")).toBe(
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
    expect(links.some((l) => l.getAttribute("data-to") === "/studio")).toBe(
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
    expect(links.some((l) => l.getAttribute("data-to") === "/studio")).toBe(
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

  it("expanded: does not render extraNavItems (operator-only injection)", () => {
    const teamItem: NavItemData = {
      to: "/my-team",
      label: "My Team",
      icon: <span>icon</span>,
    };
    render(
      withStore(<Sidebar extraNavItems={[teamItem]} />, { mode: "developer" }),
    );
    expect(screen.queryByText("My Team")).not.toBeInTheDocument();
  });

  it("expanded: does not render menuTopExtras (operator-only injection)", () => {
    const topRow = (
      <button type="button" data-testid="nav-top-row">
        n
      </button>
    );
    render(
      withStore(<Sidebar menuTopExtras={topRow} />, { mode: "developer" }),
    );
    expect(screen.queryByTestId("nav-top-row")).not.toBeInTheDocument();
  });

  it("collapsed: does not render extraNavItems (operator-only injection)", () => {
    const teamItem: NavItemData = {
      to: "/my-team",
      label: "My Team",
      icon: <span>icon</span>,
    };
    render(
      withStore(<Sidebar extraNavItems={[teamItem]} />, {
        mode: "developer",
        collapsed: true,
      }),
    );
    const rail = screen.getByTestId("sidebar-rail");
    expect(
      within(rail)
        .queryAllByRole("link")
        .some((l) => l.getAttribute("data-to") === "/my-team"),
    ).toBe(false);
  });

  it("collapsed: does not render menuTopExtras (operator-only injection)", () => {
    const topRow = (
      <button type="button" data-testid="nav-top-row">
        n
      </button>
    );
    render(
      withStore(<Sidebar menuTopExtras={topRow} />, {
        mode: "developer",
        collapsed: true,
      }),
    );
    expect(screen.queryByTestId("nav-top-row")).not.toBeInTheDocument();
  });
});

describe("<Sidebar> extraNavItems (data-driven downstream injection)", () => {
  const makeTeamItem = (): NavItemData => ({
    to: "/my-team",
    label: "My Team",
    icon: <span data-testid="nav-extra-icon">icon</span>,
  });

  it("renders no extras by default (sico)", () => {
    render(withStore(<Sidebar />));
    expect(screen.queryByText("My Team")).not.toBeInTheDocument();
  });

  it("expanded: renders an extra item after Projects", () => {
    render(withStore(<Sidebar extraNavItems={[makeTeamItem()]} />));
    const links = screen.getAllByRole("link");
    const projectsIdx = links.findIndex(
      (l) => l.getAttribute("data-to") === "/project",
    );
    const extraIdx = links.findIndex(
      (l) => l.getAttribute("data-to") === "/my-team",
    );
    expect(extraIdx).toBeGreaterThanOrEqual(0);
    // The extra follows Projects in document order.
    expect(projectsIdx).toBeLessThan(extraIdx);
  });

  it("collapsed: renders the extra item in the rail, not the expanded row", () => {
    render(
      withStore(<Sidebar extraNavItems={[makeTeamItem()]} />, {
        collapsed: true,
      }),
    );
    const rail = screen.getByTestId("sidebar-rail");
    const railExtra = within(rail)
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/my-team");
    // Rail item is labeled (aria-label), not a text row.
    expect(railExtra).toHaveAttribute("aria-label", "My Team");
  });

  it("active when pathname matches the extra item's `to`", () => {
    mockUseLocation.mockReturnValue({ pathname: "/my-team" });
    render(withStore(<Sidebar extraNavItems={[makeTeamItem()]} />));
    const extra = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/my-team");
    expect(extra).toHaveAttribute("aria-current", "page");
    expect(extra).toHaveAttribute("data-active");
  });
});

describe("<Sidebar> headerExtras (data-driven downstream injection)", () => {
  const bell = (
    <button type="button" data-testid="nav-header-bell">
      bell
    </button>
  );

  it("renders no header slot by default (sico)", () => {
    render(withStore(<Sidebar />));
    expect(screen.queryByTestId("nav-header-bell")).not.toBeInTheDocument();
  });

  it("expanded: renders headerExtras after the Collapse-sidebar toggle", () => {
    render(withStore(<Sidebar headerExtras={bell} />));
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    const slot = screen.getByTestId("nav-header-bell");
    // Header slot sits to the RIGHT of the collapse toggle (mirrors legacy dwp).
    expect(
      // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
      toggle.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("collapsed: renders headerExtras in the rail before the nav items", () => {
    render(withStore(<Sidebar headerExtras={bell} />, { collapsed: true }));
    const rail = screen.getByTestId("sidebar-rail");
    const slot = within(rail).getByTestId("nav-header-bell");
    const firstNavLink = within(rail)
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    if (!firstNavLink) {
      throw new Error("expected a /digital-worker rail link");
    }
    // Header slot precedes the first rail nav item (top-of-rail position).
    expect(
      // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
      slot.compareDocumentPosition(firstNavLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("<Sidebar> menuTopExtras (free-form downstream injection)", () => {
  const topRow = (
    <button type="button" data-testid="nav-top-row">
      notification
    </button>
  );

  it("renders no top slot by default (sico)", () => {
    render(withStore(<Sidebar />));
    expect(screen.queryByTestId("nav-top-row")).not.toBeInTheDocument();
  });

  it("expanded: renders menuTopExtras above the Digital Workers row", () => {
    render(withStore(<Sidebar menuTopExtras={topRow} />));
    const list = screen.getByTestId("sidebar-nav-list");
    const slot = within(list).getByTestId("nav-top-row");
    const dwHeader = within(list)
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    if (!dwHeader) {
      throw new Error("expected a /digital-worker nav link");
    }
    // Top slot precedes the first built-in nav item.
    expect(
      // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
      slot.compareDocumentPosition(dwHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("collapsed: renders menuTopExtras above the Digital Workers rail item", () => {
    render(withStore(<Sidebar menuTopExtras={topRow} />, { collapsed: true }));
    const rail = screen.getByTestId("sidebar-rail");
    const slot = within(rail).getByTestId("nav-top-row");
    const firstNavLink = within(rail)
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    if (!firstNavLink) {
      throw new Error("expected a /digital-worker rail link");
    }
    expect(
      // eslint-disable-next-line no-bitwise -- compareDocumentPosition returns a bitmask
      slot.compareDocumentPosition(firstNavLink) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("expanded: account menu button opens a menu with a Log out item", async () => {
    const user = userEvent.setup();
    render(withStore(<Sidebar />));
    await user.click(screen.getByRole("button", { name: "Account options" }));
    expect(
      await screen.findByRole("menuitem", { name: "Log out" }),
    ).toBeVisible();
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
    expect(screen.getByText("Digital workers")).toBeInTheDocument();
    const allLink = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("data-to") === "/digital-worker");
    expect(allLink).toBeDefined();
    expect(allLink).toHaveAttribute("aria-label", "View all digital workers");
  });

  it("renders Projects ABOVE the DW group in order (R3: no Notification, no My Team)", () => {
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
    const buttons = within(list).queryAllByRole("button");
    expect(
      buttons.find((b) => b.getAttribute("aria-label") === "Notification"),
    ).toBeUndefined();
    expect(
      buttons.find((b) => b.getAttribute("aria-label") === "My team"),
    ).toBeUndefined();
    // DOM order: projects < dwHeader < indent (Projects sits above the DW group)
    const follows = (a: Node, b: Node): boolean =>
      Boolean(
        // eslint-disable-next-line no-bitwise -- Node.compareDocumentPosition returns a bitmask
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
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
