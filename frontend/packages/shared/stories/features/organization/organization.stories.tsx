import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import axios, { type AxiosAdapter } from "axios";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";

import { userAtom } from "@/atoms/auth-atom";
import { ORGANIZATION_ENDPOINTS, RBAC_ENDPOINTS } from "@/constants/endpoints";
import { organizationSummarySchema } from "@/features/organization";
import { OrganizationManagementShell } from "@/features/organization/components/organization-management-shell";
import { OrganizationMembersPage } from "@/features/organization/components/organization-members-page";
import { OrganizationMembersPageSkeleton } from "@/features/organization/components/organization-members-page-skeleton";
import { OrganizationProjectsPage } from "@/features/organization/components/organization-projects-page";
import { OrganizationProjectsPageSkeleton } from "@/features/organization/components/organization-projects-page-skeleton";
import { ApiClientProvider } from "@/services/api-client-context";

if (!i18n.locale) {
  i18n.loadAndActivate({ locale: "en", messages: {} });
}

const organization = organizationSummarySchema.parse({
  id: 9,
  name: "Sico",
  description: "",
  creatorUsername: "owner@example.com",
  roleCodes: ["org_admin"],
  isOwner: false,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
});

const project = {
  id: 7,
  name: "Sico Demo",
  description: "Demo for team testing",
  iconUrl: "",
  memberType: 0,
  agentInstances: [],
  ownerUsername: "owner@example.com",
  creatorUsername: "owner@example.com",
  organizationId: 9,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const success = (
  data: unknown,
): { code: number; msg: string; data: unknown } => ({
  code: 0,
  msg: "success",
  data,
});

function readRoleCode(params: unknown): unknown {
  if (
    typeof params !== "object" ||
    params === null ||
    !("roleCode" in params)
  ) {
    return undefined;
  }
  return params.roleCode;
}

function getResponseData(url: string | undefined, params: unknown): unknown {
  if (url === ORGANIZATION_ENDPOINTS.list) {
    return success({
      organizations: [organization],
      total: 1,
      hasNext: false,
    });
  }
  if (url === ORGANIZATION_ENDPOINTS.root) {
    return success({ organization });
  }
  if (url === RBAC_ENDPOINTS.userRoles) {
    return success({
      roles: [
        {
          roleCode: "org_admin",
          scopeType: "org",
          scopeId: 9,
          userId: 1,
        },
      ],
      total: 1,
      hasNext: false,
    });
  }
  if (url === RBAC_ENDPOINTS.roleUsers) {
    const admin = {
      id: 1,
      email: "admin@example.com",
      alias: "Admin",
    };
    const developer = {
      id: 2,
      email: "developer@example.com",
      alias: "Developer",
    };
    const roleCode = readRoleCode(params);
    let users = [developer];
    if (roleCode === "org_member") {
      users = [admin, developer];
    } else if (roleCode === "org_admin") {
      users = [admin];
    }
    return success({ users, total: users.length, hasNext: false });
  }
  if (url === "/project/list") {
    return success({ projects: [project], total: 1, hasNext: false });
  }
  if (url === "/sandbox/list") {
    const base = {
      display_name: "Device",
      status: "available",
      allocatable: true,
      organization_id: 9,
      instance_id: "",
      instance_name: "",
      vnc_url: "",
    };
    return success({
      linux_workstation: [],
      emulator: [
        {
          ...base,
          sandbox_id: "mobile-project",
          type: "emulator",
          project_id: 7,
        },
        {
          ...base,
          sandbox_id: "mobile-free",
          type: "emulator",
          project_id: 0,
        },
      ],
      physical: [
        {
          ...base,
          sandbox_id: "windows-project",
          type: "physical",
          project_id: 7,
        },
      ],
      wincua: [
        {
          ...base,
          sandbox_id: "windows-free",
          type: "wincua",
          project_id: 0,
        },
      ],
    });
  }
  throw new Error(`Unhandled story request: ${url}`);
}

const storyAdapter: AxiosAdapter = async (config) => ({
  data:
    config.method === "get"
      ? getResponseData(config.url, config.params)
      : success({}),
  status: 200,
  statusText: "OK",
  headers: {},
  config,
});

const apiClient = axios.create({ adapter: storyAdapter });

type StoryArgs = {
  path: "/organization/members" | "/organization/projects";
};

function StoryRoot(): ReactElement {
  return (
    <OrganizationManagementShell>
      <Outlet />
    </OrganizationManagementShell>
  );
}

function MembersRoute(): ReactElement {
  return <OrganizationMembersPage />;
}

function ProjectsRoute(): ReactElement {
  return <OrganizationProjectsPage />;
}

function Frame({ path }: StoryArgs): ReactElement {
  const store = createStore();
  store.set(userAtom, {
    id: 1,
    email: "admin@example.com",
    roles: [
      { id: 1, roleCode: "platform_admin", scopeType: "platform", scopeId: 0 },
    ],
  });
  const queryClient = new QueryClient();
  const root = createRootRoute({ component: StoryRoot });
  const members = createRoute({
    getParentRoute: () => root,
    path: "/organization/members",
    component: MembersRoute,
  });
  const projects = createRoute({
    getParentRoute: () => root,
    path: "/organization/projects",
    component: ProjectsRoute,
  });
  const router = createRouter({
    routeTree: root.addChildren([members, projects]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <RouterProvider router={router} />
        </ApiClientProvider>
      </QueryClientProvider>
    </Provider>
  );
}

const meta: Meta<StoryArgs> = {
  title: "Organization/ManageOrganization",
  decorators: [
    (Story) => (
      <I18nProvider i18n={i18n}>
        <Story />
      </I18nProvider>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    docs: { source: { code: "<OrganizationMembersPage />" } },
  },
  args: { path: "/organization/members" },
  render: (args) => <Frame path={args.path} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** Members page with real query composition and Admin/Developer rows. */
export const Members: Story = {};

/** Projects page with device inventory cards and project allocation counts. */
export const Projects: Story = {
  args: { path: "/organization/projects" },
  parameters: {
    docs: { source: { code: "<OrganizationProjectsPage />" } },
  },
};

/** Members page loading state with its action-strip and table placeholders. */
export const MembersLoading: Story = {
  render: () => <OrganizationMembersPageSkeleton />,
  parameters: {
    docs: { source: { code: "<OrganizationMembersPageSkeleton />" } },
  },
};

/** Projects page loading state with stat-card and table placeholders. */
export const ProjectsLoading: Story = {
  render: () => <OrganizationProjectsPageSkeleton />,
  parameters: {
    docs: { source: { code: "<OrganizationProjectsPageSkeleton />" } },
  },
};
