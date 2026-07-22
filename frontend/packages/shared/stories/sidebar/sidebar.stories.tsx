/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import { Bell, Users } from "lucide-react";
import type { ReactElement } from "react";

import { userAtom } from "@/atoms/auth-atom";
import { Sidebar } from "@/features/sidebar/components/sidebar";
import { ApiClientProvider } from "@/services/api-client-context";

const fakeUser = { id: 1, email: "operator@sico.local", roles: [] };
const defaultApiClient = {
  get: async () => ({
    data: {
      code: 0,
      msg: "",
      data: {
        items: [
          { id: 1, name: "Arena, Legal Counsel" },
          { id: 2, name: "Max, Tester" },
        ],
        total: 2,
        page: 1,
        pageSize: 50,
        hasNext: false,
      },
    },
  }),
  post: async () => ({ data: { code: 0, msg: "", data: {} } }),
} as unknown as AxiosInstance;

const loadingApiClient = {
  get: () => new Promise(() => {}),
  post: async () => ({ data: { code: 0, msg: "", data: {} } }),
} as unknown as AxiosInstance;

const emptyApiClient = {
  get: async () => ({
    data: {
      code: 0,
      msg: "",
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        hasNext: false,
      },
    },
  }),
  post: async () => ({ data: { code: 0, msg: "", data: {} } }),
} as unknown as AxiosInstance;

const errorApiClient = {
  get: async () => {
    throw new Error("network");
  },
  post: async () => ({ data: { code: 0, msg: "", data: {} } }),
} as unknown as AxiosInstance;

function Frame({
  children,
  apiClient,
}: {
  children: ReactElement;
  apiClient: AxiosInstance;
}): ReactElement {
  const store = createStore();
  store.set(userAtom, fakeUser);
  const qc = new QueryClient();
  const rootRoute = createRootRoute({ component: () => children });
  const dwRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker",
    component: () => null,
  });
  const projRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project",
    component: () => null,
  });
  const dwIdRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/digital-worker/$agentId/collaboration",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([dwRoute, projRoute, dwIdRoute]),
    history: createMemoryHistory({ initialEntries: ["/digital-worker"] }),
  });
  return (
    <Provider store={store}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={apiClient}>
          <div className="bg-background flex h-screen">
            <RouterProvider router={router} />
          </div>
        </ApiClientProvider>
      </QueryClientProvider>
    </Provider>
  );
}

type StoryArgs = { apiClient: AxiosInstance };

// `Sidebar` reads its data through context, so `apiClient` is a synthetic
// story arg, not a real prop. No single `component` → type the meta with
// `Meta<StoryArgs>` directly (CSF 3.0 composed-story form).
const meta: Meta<StoryArgs> = {
  title: "Components/Sidebar",
  parameters: {
    layout: "fullscreen",
    // The dynamic snapshot would dump the fake axios object; pin the Docs
    // code to the real public call instead.
    docs: { source: { code: "<Sidebar />" } },
  },
  tags: ["autodocs"],
  render: (args) => (
    <Frame apiClient={args.apiClient}>
      <Sidebar />
    </Frame>
  ),
  args: { apiClient: defaultApiClient },
};
export default meta;
type Story = StoryObj<StoryArgs>;

/** Default expanded rail backed by a populated DW list. */
export const Expanded: Story = {};

/** Collapsed rail — icon-only nav for narrow viewports. */
export const Collapsed: Story = {
  parameters: { sidebarStartCollapsed: true },
};

/** DW list never resolves — exercises the loading skeleton. */
export const Loading: Story = {
  args: { apiClient: loadingApiClient },
};

/** API returns zero agents — exercises the empty state. */
export const Empty: Story = {
  args: { apiClient: emptyApiClient },
};

/** DW fetch rejects — exercises the inline error state. */
export const ErrorState: Story = {
  args: { apiClient: errorApiClient },
};

/**
 * Downstream injection (dwp): an extra "My Team" nav item rendered with sico's
 * own chrome after the built-ins, plus a header-slot notification bell. Both
 * the expanded list and the collapsed rail show the injected entry.
 */
export const WithExtraNavItems: Story = {
  render: (args) => {
    const store = createStore();
    store.set(userAtom, fakeUser);
    const qc = new QueryClient();
    const rootRoute = createRootRoute({
      component: () => (
        <Sidebar
          extraNavItems={[
            {
              to: "/my-team",
              label: "My Team",
              icon: <Users className="size-5" />,
            },
          ]}
          headerExtras={
            <button type="button" aria-label="Notifications">
              <Bell className="size-5" />
            </button>
          }
        />
      ),
    });
    const dwRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/digital-worker",
      component: () => null,
    });
    const projRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/project",
      component: () => null,
    });
    const teamRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/my-team",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([dwRoute, projRoute, teamRoute]),
      history: createMemoryHistory({ initialEntries: ["/my-team"] }),
    });
    return (
      <Provider store={store}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={args.apiClient}>
            <div className="bg-background flex h-screen">
              <RouterProvider router={router} />
            </div>
          </ApiClientProvider>
        </QueryClientProvider>
      </Provider>
    );
  },
};
