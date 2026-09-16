import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { type JSX } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-bound-organization", () => ({
  useBoundOrganizationQuery: () => ({ data: { id: 7 } }),
}));

const mockUseOrganizationPermissionSuspense = vi.fn();
vi.mock("@/features/rbac/hooks/use-organization-permission", () => ({
  useOrganizationPermissionSuspense: () =>
    mockUseOrganizationPermissionSuspense(),
}));

const { StudioLayout } =
  await import("@/features/studio/components/studio-layout");
const { StudioSkeleton } =
  await import("@/features/studio/components/studio-skeleton");

const childPending = new Promise<never>(() => {});
let suspendChild = false;

function StudioChild(): JSX.Element {
  if (suspendChild) {
    // oxlint-disable-next-line typescript-eslint/only-throw-error -- Suspense catches a pending thenable
    throw childPending;
  }
  return <h1>Studio child</h1>;
}

function renderLayout({
  initialPath = "/studio",
  routePaths = [initialPath],
}: {
  initialPath?: string;
  routePaths?: string[];
} = {}): { navigate: (to: string) => Promise<void> } {
  const rootRoute = createRootRoute({
    component: function Root() {
      return (
        <StudioLayout>
          <StudioChild />
        </StudioLayout>
      );
    },
  });
  const routes = routePaths.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    navigate: async (to: string): Promise<void> => {
      await router.navigate({ to });
    },
  };
}

beforeEach(() => {
  mockUseOrganizationPermissionSuspense.mockReset();
  suspendChild = false;
});

describe("<StudioLayout>", () => {
  it("renders Studio-specific card placeholders", () => {
    render(<StudioSkeleton />);

    expect(screen.getAllByTestId("studio-card-skeleton")).toHaveLength(6);
    expect(screen.queryByTestId("digital-worker-card-skeleton")).toBeNull();
  });

  it("renders its child route when Studio access is available", async () => {
    mockUseOrganizationPermissionSuspense.mockReturnValue({
      canEnterStudio: true,
    });

    renderLayout();

    expect(
      await screen.findByRole("heading", { name: "Studio child" }),
    ).toBeVisible();
  });

  it("shows the Studio skeleton while list child data is pending", async () => {
    mockUseOrganizationPermissionSuspense.mockReturnValue({
      canEnterStudio: true,
    });
    suspendChild = true;

    renderLayout();

    expect(
      await screen.findByRole("status", { name: "Loading Studio" }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Studio child" })).toBeNull();
  });

  it("renders the access-denied state when Studio access is unavailable", async () => {
    mockUseOrganizationPermissionSuspense.mockReturnValue({
      canEnterStudio: false,
    });

    renderLayout();

    expect(await screen.findByTestId("studio-access-denied")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Studio child" })).toBeNull();
  });

  it.each(["/studio", "/studio/"])(
    "shows the Studio skeleton while access is pending at %s",
    async (initialPath) => {
      const pending = new Promise<never>(() => {});
      mockUseOrganizationPermissionSuspense.mockImplementation(() => {
        // oxlint-disable-next-line typescript-eslint/only-throw-error -- Suspense catches a pending thenable
        throw pending;
      });

      renderLayout({ initialPath });

      expect(
        await screen.findByRole("status", { name: "Loading Studio" }),
      ).toBeVisible();
      expect(
        screen.queryByRole("status", {
          name: "Loading digital worker setup",
        }),
      ).toBeNull();
    },
  );

  it.each([
    "/studio/setup",
    "/studio/setup/",
    "/studio/agent-1/setup",
    "/studio/agent-1/setup/",
  ])(
    "shows the setup skeleton while access is pending at %s",
    async (initialPath) => {
      const pending = new Promise<never>(() => {});
      mockUseOrganizationPermissionSuspense.mockImplementation(() => {
        // oxlint-disable-next-line typescript-eslint/only-throw-error -- Suspense catches a pending thenable
        throw pending;
      });

      renderLayout({ initialPath });

      expect(
        await screen.findByRole("status", {
          name: "Loading digital worker setup",
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("status", { name: "Loading Studio" }),
      ).toBeNull();
    },
  );

  it("defaults to the Studio skeleton for an unknown child path", async () => {
    const pending = new Promise<never>(() => {});
    mockUseOrganizationPermissionSuspense.mockImplementation(() => {
      // oxlint-disable-next-line typescript-eslint/only-throw-error -- Suspense catches a pending thenable
      throw pending;
    });

    renderLayout({ initialPath: "/studio/agent-1/preview" });

    expect(
      await screen.findByRole("status", { name: "Loading Studio" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("status", { name: "Loading digital worker setup" }),
    ).toBeNull();
  });

  it("renders the error fallback when the permission query fails", async () => {
    mockUseOrganizationPermissionSuspense.mockImplementation(() => {
      throw new Error("permission failed");
    });

    renderLayout();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong on this page. Try again.",
    );
    expect(screen.queryByRole("heading", { name: "Studio child" })).toBeNull();
  });

  it("resets the error fallback when the pathname changes", async () => {
    mockUseOrganizationPermissionSuspense.mockImplementation(() => {
      throw new Error("permission failed");
    });
    const router = renderLayout({
      initialPath: "/studio",
      routePaths: ["/studio", "/studio/setup"],
    });
    await screen.findByRole("alert");
    mockUseOrganizationPermissionSuspense.mockReturnValue({
      canEnterStudio: true,
    });

    await act(async () => {
      await router.navigate("/studio/setup");
    });

    expect(
      await screen.findByRole("heading", { name: "Studio child" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
