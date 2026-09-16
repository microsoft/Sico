import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { createStore, Provider } from "jotai";
import type { ComponentType, ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loginAtom } from "@/atoms/auth-atom";
import { type OrganizationSummary } from "@/features/organization/schemas/organization";
import * as organizationService from "@/features/organization/services/organization";
import { ApiClientProvider } from "@/services/api-client-context";

import { makeLoginPayload } from "../../../helpers/organization-context";

const { membersContentSpy, projectsContentSpy } = vi.hoisted(() => ({
  membersContentSpy: vi.fn(),
  projectsContentSpy: vi.fn(),
}));

vi.mock("@/features/organization/services/organization");
vi.mock(
  "@/features/organization/components/organization-members-page-content",
  () => ({
    OrganizationMembersPageContent: ({
      organization,
    }: {
      organization: OrganizationSummary;
    }) => {
      membersContentSpy(organization);
      return <main aria-label="Members content" />;
    },
  }),
);
vi.mock(
  "@/features/organization/components/organization-projects-page-content",
  () => ({
    OrganizationProjectsPageContent: ({
      organization,
    }: {
      organization: OrganizationSummary;
    }) => {
      projectsContentSpy(organization);
      return <main aria-label="Projects content" />;
    },
  }),
);

const organization: OrganizationSummary = {
  id: 9,
  name: "SICO",
  description: "",
  createdAt: 1,
  updatedAt: 1,
  creatorUsername: "owner@example.com",
  roleCodes: ["org_admin"],
  isOwner: false,
};

type PageKind = "Members" | "Projects";

type OrganizationPageContract = {
  pageName: string;
  pageKind: PageKind;
  loadPage: () => Promise<ComponentType>;
};

function renderPage(Page: ComponentType): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const apiClient = axios.create();
  const store = createStore();
  store.set(loginAtom, makeLoginPayload());

  function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  }

  render(<Page />, { wrapper: Wrapper });
}

export function defineOrganizationPageContract({
  pageName,
  pageKind,
  loadPage,
}: OrganizationPageContract): void {
  const ownContentSpy =
    pageKind === "Members" ? membersContentSpy : projectsContentSpy;
  const otherContentSpy =
    pageKind === "Members" ? projectsContentSpy : membersContentSpy;
  const loadingLabel = `Loading ${pageKind.toLowerCase()}`;
  let Page: ComponentType;

  describe(pageName, () => {
    beforeAll(async () => {
      Page = await loadPage();
    });

    beforeEach(() => {
      vi.mocked(organizationService.fetchUserOrganizations).mockReset();
      membersContentSpy.mockReset();
      projectsContentSpy.mockReset();
    });

    it("renders its own loading state", () => {
      vi.mocked(organizationService.fetchUserOrganizations).mockReturnValue(
        new Promise(() => {
          // Intentionally pending to exercise the page-owned suspense fallback.
        }),
      );

      renderPage(Page);

      expect(screen.getByRole("status", { name: loadingLabel })).toBeVisible();
    });

    it(`renders ${pageKind.toLowerCase()} content for the bound organization`, async () => {
      vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
        organization,
      ]);

      renderPage(Page);

      expect(
        await screen.findByRole("main", { name: `${pageKind} content` }),
      ).toBeVisible();
      expect(ownContentSpy).toHaveBeenCalledWith(organization);
    });

    it("does not mount the other page content", async () => {
      vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue([
        organization,
      ]);

      renderPage(Page);

      await screen.findByRole("main", { name: `${pageKind} content` });
      expect(otherContentSpy).not.toHaveBeenCalled();
      expect(screen.getAllByRole("main")).toHaveLength(1);
    });

    it("renders the unavailable state without a bound organization", async () => {
      vi.mocked(organizationService.fetchUserOrganizations).mockResolvedValue(
        [],
      );

      renderPage(Page);

      expect(
        await screen.findByRole("heading", {
          level: 2,
          name: "No organization available",
        }),
      ).toBeVisible();
    });

    it("renders an error state when the organization request fails", async () => {
      vi.mocked(organizationService.fetchUserOrganizations).mockRejectedValue(
        new Error("organization failed"),
      );

      renderPage(Page);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Something went wrong",
      );
    });

    it("recovers after Try again", async () => {
      vi.mocked(organizationService.fetchUserOrganizations)
        .mockRejectedValueOnce(new Error("organization failed"))
        .mockResolvedValueOnce([organization]);
      const user = userEvent.setup();

      renderPage(Page);
      await user.click(
        await screen.findByRole("button", { name: "Try again" }),
      );

      expect(
        await screen.findByRole("main", { name: `${pageKind} content` }),
      ).toBeVisible();
      expect(organizationService.fetchUserOrganizations).toHaveBeenCalledTimes(
        2,
      );
    });
  });
}
