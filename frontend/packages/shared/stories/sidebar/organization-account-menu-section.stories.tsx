import { type Messages, setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@sico/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { createStore, Provider } from "jotai";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { fn } from "storybook/test";

import avatarUrl from "@/assets/dw-avatars/7661735044884463616.png";
import { userAtom } from "@/atoms/auth-atom";
import { ORGANIZATION_ENDPOINTS } from "@/constants/endpoints";
import { selectedOrganizationIdAtom } from "@/features/organization/atoms/selected-organization-atom";
import type { OrganizationSummary } from "@/features/organization/schemas/organization";
import { ManageOrganizationMenuItem } from "@/features/sidebar/components/manage-organization-menu-item";
import { OrganizationAccountMenuSection } from "@/features/sidebar/components/organization-account-menu-section";
import { SwitchToSicoDevMenuItem } from "@/features/sidebar/components/switch-to-sico-dev-menu-item";
import { ApiClientProvider } from "@/services/api-client-context";

type StoryArgs = {
  organizations: OrganizationSummary[];
  selectedOrganizationId: number | null;
  state: "success" | "loading" | "error";
  showManagement: boolean;
};

const organizations: OrganizationSummary[] = [
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

function Frame({
  children,
  ...args
}: StoryArgs & { children: ReactNode }): ReactElement | null {
  const [storyI18n] = useState(() => setupI18n());
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState<Error | null>(null);
  useEffect(() => {
    let mounted = true;
    const locale = "en";

    async function loadCatalog(): Promise<void> {
      try {
        // oxlint-disable-next-line typescript-eslint/no-unsafe-assignment -- generated catalogs have no declarations; pin their known export shape at the import boundary
        const catalog: { messages: Messages } = await import(
          `../../src/locales/${locale}/messages.mjs`
        );
        if (mounted) {
          storyI18n.loadAndActivate({ locale, messages: catalog.messages });
          setCatalogLoaded(true);
        }
      } catch (error) {
        if (mounted) {
          setCatalogError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }

    void loadCatalog();
    return () => {
      mounted = false;
    };
  }, [storyI18n]);
  const [store] = useState(() => {
    const next = createStore();
    next.set(userAtom, { id: 7, email: "member@sico.test", roles: [] });
    next.set(selectedOrganizationIdAtom, args.selectedOrganizationId);
    return next;
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
  );
  const [apiClient] = useState(() => {
    const client = axios.create();
    const request = new MockAdapter(client).onGet(ORGANIZATION_ENDPOINTS.list);
    if (args.state === "loading") {
      request.reply(() => new Promise(() => {}));
    } else if (args.state === "error") {
      request.networkError();
    } else {
      request.reply(200, {
        code: 0,
        msg: "",
        data: {
          organizations: args.organizations,
          total: args.organizations.length,
          hasNext: false,
        },
      });
    }
    return client;
  });
  useEffect(() => () => queryClient.clear(), [queryClient]);
  if (catalogError) {
    throw catalogError;
  }
  if (!catalogLoaded) {
    return null;
  }
  return (
    <I18nProvider i18n={storyI18n}>
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    </I18nProvider>
  );
}

const meta: Meta<StoryArgs> = {
  title: "Components/OrganizationAccountMenuSection",
  parameters: {
    layout: "centered",
    docs: { source: { code: "<OrganizationAccountMenuSection />" } },
  },
  args: {
    organizations,
    selectedOrganizationId: null,
    state: "success",
    showManagement: false,
  },
  decorators: [
    (Story, { args }) => (
      <Frame
        key={JSON.stringify(args)}
        organizations={args.organizations}
        selectedOrganizationId={args.selectedOrganizationId}
        state={args.state}
        showManagement={args.showManagement}
      >
        <Story />
      </Frame>
    ),
  ],
  render: (args) => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Account options</DropdownMenuTrigger>
      <DropdownMenuContent className="w-49">
        <OrganizationAccountMenuSection>
          <ManageOrganizationMenuItem
            visible={args.showManagement}
            onSelect={fn()}
          />
        </OrganizationAccountMenuSection>
        {args.showManagement ? (
          <SwitchToSicoDevMenuItem visible onSelect={fn()} />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
export default meta;
type Story = StoryObj<StoryArgs>;

/** A member can choose between organizations with overlapping name prefixes. */
export const MultipleOrganizations: Story = {};

/** Saved images appear beside the current organization and inside the switcher. */
export const SavedAvatars: Story = {
  args: {
    organizations: organizations.map((organization) => ({
      ...organization,
      iconUrl: avatarUrl,
    })),
  },
};

/** Management belongs to the organization group, above its closing divider. */
export const WithManagement: Story = {
  args: { ...SavedAvatars.args, showManagement: true },
  parameters: {
    docs: {
      source: {
        code: "<OrganizationAccountMenuSection>\n  <ManageOrganizationMenuItem visible={permission.canManage} onSelect={onManage} />\n</OrganizationAccountMenuSection>",
      },
    },
  },
};

/** A single organization remains visible and selected. */
export const SingleOrganization: Story = {
  args: { organizations: organizations.slice(0, 1) },
};

/** The saved organization is selected instead of the first list entry. */
export const SelectedOrganization: Story = {
  args: { selectedOrganizationId: 2 },
};

/** An empty organization list leaves no organization group or divider. */
export const NoOrganizations: Story = {
  args: { organizations: [] },
};

/** Loading disables selection without inserting placeholder organizations. */
export const Loading: Story = {
  args: { state: "loading" },
};

/** A failed organization request displays an unavailable selection state. */
export const ErrorState: Story = {
  args: { state: "error" },
};
