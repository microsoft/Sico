import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { userAtom } from "@/atoms/auth-atom";
import { ORGANIZATION_ENDPOINTS } from "@/constants/endpoints";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import { organizationKeys } from "@/features/organization/query-keys";
import type { OrganizationSummary } from "@/features/organization/schemas/organization";
import { OrganizationAccountMenuSection } from "@/features/sidebar/components/organization-account-menu-section";
import { ApiClientProvider } from "@/services/api-client-context";
import { persistLoginPayload } from "@/utils/auth-storage";
import {
  getItemFromLocalStorage,
  removeItemFromLocalStorage,
  SELECTED_ORGANIZATION_ID_LS,
  setItemToLocalStorage,
} from "@/utils/local-storage";

import { makeLoginPayload } from "../../helpers/organization-context";

function makeOrganizations(): OrganizationSummary[] {
  return [
    {
      id: 1,
      name: "Alpha",
      description: "",
      createdAt: 0,
      updatedAt: 0,
      creatorUsername: "owner",
      roleCodes: ["org_member"],
      isOwner: false,
    },
    {
      id: 2,
      name: "Beta",
      description: "",
      createdAt: 0,
      updatedAt: 0,
      creatorUsername: "owner",
      roleCodes: ["org_member"],
      isOwner: false,
    },
    {
      id: 3,
      name: "Bravo",
      description: "",
      createdAt: 0,
      updatedAt: 0,
      creatorUsername: "owner",
      roleCodes: ["org_member"],
      isOwner: false,
    },
  ];
}

function loadedImage(): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 1 },
  });
  return image;
}

const queryClients: QueryClient[] = [];

function renderMenu({
  organizations = makeOrganizations(),
  state = "success",
}: {
  organizations?: OrganizationSummary[];
  state?: "success" | "loading" | "error";
} = {}): {
  store: ReturnType<typeof createStore>;
  queryClient: QueryClient;
  apiMock: MockAdapter;
  organizations: OrganizationSummary[];
} {
  const store = createStore();
  store.set(userAtom, { id: 7, email: "member@sico.test", roles: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  queryClients.push(queryClient);
  const apiClient = axios.create();
  const apiMock = new MockAdapter(apiClient);
  const request = apiMock.onGet(ORGANIZATION_ENDPOINTS.list);
  if (state === "loading") {
    request.reply(() => new Promise(() => {}));
  } else if (state === "error") {
    request.networkError();
  } else {
    request.reply(200, {
      code: 0,
      msg: "",
      data: { organizations, total: organizations.length, hasNext: false },
    });
  }
  render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <DropdownMenu defaultOpen>
            <DropdownMenuTrigger>Account options</DropdownMenuTrigger>
            <DropdownMenuContent>
              <OrganizationAccountMenuSection />
            </DropdownMenuContent>
          </DropdownMenu>
        </ApiClientProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return { store, queryClient, apiMock, organizations };
}

const reload = vi.fn();

beforeEach(() => {
  persistLoginPayload(makeLoginPayload(7));
  reload.mockReset();
  const location = { ...window.location, reload };
  vi.stubGlobal(
    "window",
    new Proxy(window, {
      get(target, property): unknown {
        return property === "location"
          ? location
          : Reflect.get(target, property);
      },
    }),
  );
});
afterEach(() => {
  for (const queryClient of queryClients.splice(0)) {
    queryClient.clear();
  }
  removeItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
  vi.unstubAllGlobals();
});

describe("OrganizationAccountMenuSection", () => {
  describe("saved avatars", () => {
    beforeEach(() => {
      vi.spyOn(window, "Image").mockImplementation(loadedImage);
    });
    afterEach(() => vi.restoreAllMocks());

    it("renders the current organization's saved avatar", async () => {
      renderMenu({
        organizations: makeOrganizations().map((organization) => ({
          ...organization,
          iconUrl: `/storage/organizations/${organization.id}/icons/avatar.png`,
        })),
      });

      const current = await screen.findByTestId("current-organization");
      expect(
        await within(current).findByTestId("organization-avatar-image"),
      ).toHaveAttribute("src", "/storage/organizations/1/icons/avatar.png");
    });

    it("renders saved avatars in the organization switcher", async () => {
      const user = userEvent.setup();
      renderMenu({
        organizations: makeOrganizations().map((organization) => ({
          ...organization,
          iconUrl: `/storage/organizations/${organization.id}/icons/avatar.png`,
        })),
      });
      await user.hover(
        await screen.findByRole("menuitem", { name: "Switch Organization" }),
      );

      const item = await screen.findByRole("menuitemradio", { name: "Beta" });
      expect(
        await within(item).findByTestId("organization-avatar-image"),
      ).toHaveAttribute("src", "/storage/organizations/2/icons/avatar.png");
    });

    it("refreshes the current avatar after the organization cache is invalidated", async () => {
      const { queryClient, apiMock, organizations } = renderMenu();
      await screen.findByTestId("current-organization");
      apiMock.onGet(ORGANIZATION_ENDPOINTS.list).reply(200, {
        code: 0,
        msg: "success",
        data: {
          organizations: organizations.map((organization) => ({
            ...organization,
            iconUrl: "/storage/organizations/1/icons/updated.png",
          })),
          total: organizations.length,
          hasNext: false,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: organizationKeys.userOrganizations(7),
        exact: true,
      });

      const current = screen.getByTestId("current-organization");
      expect(
        await within(current).findByTestId("organization-avatar-image"),
      ).toHaveAttribute("src", "/storage/organizations/1/icons/updated.png");
    });
  });

  it("keeps the initial when the organization has no avatar", async () => {
    renderMenu();

    const current = await screen.findByTestId("current-organization");
    expect(
      within(current).getByTestId("organization-avatar"),
    ).toHaveTextContent("A");
  });

  it("lists only the returned organizations and checks the current one", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.hover(
      await screen.findByRole("menuitem", { name: "Switch Organization" }),
    );

    const items = await screen.findAllByRole("menuitemradio");
    expect(items).toHaveLength(3);
    expect(
      screen.getByRole("menuitemradio", { name: "Alpha" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Beta" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.getByRole("menuitemradio", { name: "Bravo" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("switches the current organization and persists it without changing the list cache", async () => {
    const user = userEvent.setup();
    const { store, queryClient, organizations, apiMock } = renderMenu();
    await user.click(
      await screen.findByRole("menuitem", { name: "Switch Organization" }),
    );
    await user.keyboard("{ArrowRight}{ArrowDown}{Enter}");

    expect(store.get(selectedOrganizationIdAtom)).toBe(2);
    expect(getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS)).toBe("2");
    expect(
      queryClient.getQueryData(organizationKeys.userOrganizations(7)),
    ).toEqual(organizations);
    expect(apiMock.history.get).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Account options" }));
    expect(await screen.findByTestId("current-organization")).toHaveTextContent(
      "Beta",
    );
  });

  it("persists the selected organization before reloading the page", async () => {
    const user = userEvent.setup();
    renderMenu();
    let savedOrganization: string | null = null;
    reload.mockImplementation(() => {
      savedOrganization = getItemFromLocalStorage(SELECTED_ORGANIZATION_ID_LS);
    });
    await user.click(
      await screen.findByRole("menuitem", { name: "Switch Organization" }),
    );

    await user.keyboard("{ArrowRight}{ArrowDown}{Enter}");

    expect(reload).toHaveBeenCalledOnce();
    expect(savedOrganization).toBe("2");
  });

  it("does not reload when selecting the current organization", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      await screen.findByRole("menuitem", { name: "Switch Organization" }),
    );

    await user.keyboard("{ArrowRight}{Enter}");

    expect(reload).not.toHaveBeenCalled();
  });

  it("selects by the organization name when names share a typeahead prefix", async () => {
    const user = userEvent.setup();
    const { store } = renderMenu();
    await user.click(
      await screen.findByRole("menuitem", { name: "Switch Organization" }),
    );
    await user.keyboard("{ArrowRight}br");

    expect(screen.getByRole("menuitemradio", { name: /Bravo/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(store.get(selectedOrganizationIdAtom)).toBe(3);
  });

  it("restores the saved organization when the menu mounts", async () => {
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "2");
    renderMenu();

    expect(await screen.findByTestId("current-organization")).toHaveTextContent(
      "Beta",
    );
  });

  it("shows the resolved first organization for an unavailable saved ID", async () => {
    setItemToLocalStorage(SELECTED_ORGANIZATION_ID_LS, "999");
    renderMenu();

    expect(await screen.findByTestId("current-organization")).toHaveTextContent(
      "Alpha",
    );
  });

  it("does not render an organization group for an empty list", async () => {
    const { queryClient } = renderMenu({ organizations: [] });
    const menu = await screen.findByRole("menu");
    await waitFor(() =>
      expect(
        queryClient.getQueryState(organizationKeys.userOrganizations(7))
          ?.status,
      ).toBe("success"),
    );

    expect(
      within(menu).queryByRole("menuitem", { name: "Switch Organization" }),
    ).toBeNull();
    expect(within(menu).queryByTestId("current-organization")).toBeNull();
    expect(within(menu).queryByRole("separator")).toBeNull();
  });

  it("disables organization selection while the list is loading", async () => {
    renderMenu({ state: "loading" });

    expect(
      await screen.findByRole("menuitem", { name: "Loading organizations…" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("menuitem", { name: "Switch Organization" }),
    ).toBeNull();
  });

  it("disables organization selection when fetching fails", async () => {
    renderMenu({ state: "error" });

    expect(
      await screen.findByRole("menuitem", {
        name: "Couldn't load organizations",
      }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("menuitem", { name: "Switch Organization" }),
    ).toBeNull();
    expect(screen.queryByTestId("current-organization")).toBeNull();
  });
});
