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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectWorkspace } from "@/features/projects/components/project-workspace";
import { useKnowledgeTagsQuery } from "@/features/projects/hooks/use-knowledge-tags-query";
import { useProjectMutation } from "@/features/projects/hooks/use-project-mutation";
import { useProjectDetailQuery } from "@/features/projects/hooks/use-project-query";
import {
  type AssetSearch,
  assetSearchSchema,
} from "@/features/projects/schemas/asset-search";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import {
  MemberTypeSchema,
  type ProjectDetail,
} from "@/features/projects/schemas/project";
import type { AssetCategory } from "@/features/projects/types";

const { navigateMock, mutateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock("@/features/projects/hooks/use-project-query", () => ({
  useProjectDetailQuery: vi.fn(),
}));

vi.mock("@/features/projects/hooks/use-project-mutation", () => ({
  useProjectMutation: vi.fn(),
}));

vi.mock("@/features/projects/hooks/use-knowledge-tags-query", () => ({
  useKnowledgeTagsQuery: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});

// Stub the heavy table so the workspace under test never fires its own query.
// It exposes the `onAddKnowledge` callback through a button so the wiring test
// (workspace opens the dialog) survives the toolbar moving into the table.
vi.mock("@/features/projects/components/assets-table", () => ({
  AssetsTable: ({ onAddKnowledge }: { onAddKnowledge: () => void }) => (
    <div>
      assets-table
      <button type="button" onClick={onAddKnowledge}>
        Add Knowledge
      </button>
    </div>
  ),
}));

// Stub the two dialogs to a presence marker so we can assert open state without
// booting their suspending internals.
vi.mock("@/features/projects/components/add-knowledge-dialog", () => ({
  AddKnowledgeDialog: ({ open }: { open: boolean }) =>
    open ? <div>add-knowledge-open</div> : null,
}));

vi.mock("@/features/projects/components/edit-project-dialog", () => ({
  EditProjectDialog: ({ open }: { open: boolean }) =>
    open ? <div>edit-project-open</div> : null,
}));

function makeProject(partial: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 1,
    name: "E-commerce Platform",
    description: "A short project summary.",
    iconUrl: "",
    memberType: MemberTypeSchema.enum.OWNER,
    agentInstances: [
      { id: 1, iconUrl: "" },
      { id: 2, iconUrl: "" },
    ],
    ownerUsername: "owner@microsoft.com",
    creatorUsername: "amy@microsoft.com",
    operatorAdmins: ["jessica@microsoft.com", "michael@microsoft.com"],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function makeKnowledgeTag(partial: Partial<KnowledgeTag> = {}): KnowledgeTag {
  return {
    id: 1,
    projectId: 1,
    name: "Knowledge tag",
    description: "",
    creatorUsername: "amy@microsoft.com",
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

const PROJECT_ID = 7;
const SEARCH: AssetSearch = assetSearchSchema.parse({});

function renderWorkspace(): { user: ReturnType<typeof userEvent.setup> } {
  const queryClient = new QueryClient();
  const user = userEvent.setup();
  // Fresh jotai store per render so the per-project `projectDrawerCollapsedAtom`
  // (drawer collapse) doesn't leak between tests (mirrors sidebar.test.tsx).
  const store = createStore();

  function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </Provider>
    );
  }

  render(
    <ProjectWorkspace
      projectId={PROJECT_ID}
      category="all"
      search={SEARCH}
      onSearchChange={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProjectDetailQuery).mockReturnValue({
    data: makeProject(),
  } as never);
  vi.mocked(useKnowledgeTagsQuery).mockReturnValue({
    data: { items: [], total: 0, hasNext: false },
  } as never);
  vi.mocked(useProjectMutation).mockReturnValue({
    mutate: mutateMock,
  } as never);
});

describe("ProjectWorkspace", () => {
  it("renders the project title", () => {
    vi.mocked(useProjectDetailQuery).mockReturnValue({
      data: makeProject({ name: "Atlas" }),
    } as never);
    renderWorkspace();
    // The real drawer also renders `project.name` as a <p>; the workspace
    // title is the heading, so query by role to disambiguate.
    expect(screen.getByRole("heading", { name: "Atlas" })).toBeInTheDocument();
  });

  it("flips drawer visibility with the collapse / Project details toggles", async () => {
    const { user } = renderWorkspace();
    expect(
      screen.getByRole("region", { name: "Project details" }),
    ).toBeInTheDocument();
    // Collapse from inside the drawer header...
    await user.click(screen.getByRole("button", { name: "Collapse panel" }));
    expect(
      screen.queryByRole("region", { name: "Project details" }),
    ).not.toBeInTheDocument();
    // ...and re-expand from the breadcrumb toggle that only shows when collapsed.
    await user.click(screen.getByRole("button", { name: "Show panel" }));
    expect(
      screen.getByRole("region", { name: "Project details" }),
    ).toBeInTheDocument();
  });

  it("opens the add-knowledge dialog when Add Knowledge is clicked", async () => {
    const { user } = renderWorkspace();
    expect(screen.queryByText("add-knowledge-open")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add Knowledge/ }));
    expect(screen.getByText("add-knowledge-open")).toBeInTheDocument();
  });

  it("opens the edit-project dialog from the drawer's edit control", async () => {
    vi.mocked(useProjectDetailQuery).mockReturnValue({
      data: makeProject({ memberType: MemberTypeSchema.enum.OWNER }),
    } as never);
    const { user } = renderWorkspace();
    expect(screen.queryByText("edit-project-open")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit project" }));
    expect(screen.getByText("edit-project-open")).toBeInTheDocument();
  });

  it("navigates to the knowledge-tags route from View all", async () => {
    const knowledgeTags = [1, 2, 3, 4].map((n) =>
      makeKnowledgeTag({ id: n, name: `Knowledge tag ${n}` }),
    );
    vi.mocked(useKnowledgeTagsQuery).mockReturnValue({
      data: {
        items: knowledgeTags,
        total: knowledgeTags.length,
        hasNext: false,
      },
    } as never);
    const { user } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "View all" }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/project/$projectId/knowledge-tags",
        params: { projectId: String(PROJECT_ID) },
      }),
    );
  });

  it("removes an operator by sending the full remaining set to the mutation", async () => {
    const { user } = renderWorkspace();

    await user.click(
      screen.getByRole("button", {
        name: "Actions for jessica@microsoft.com",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));

    // The next full operatorAdmins set (jessica dropped) is sent — an omission
    // would let syncProjectAdmins wipe the rest.
    expect(mutateMock).toHaveBeenCalledWith(
      { operatorAdmins: ["michael@microsoft.com"] },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("renders the ErrorView fallback when a query throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(useProjectDetailQuery).mockImplementation(() => {
      throw new Error("boom");
    });
    renderWorkspace();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    spy.mockRestore();
  });
});

// I2 / I-A regression: the drawer-collapse lives in a per-project atom
// (`projectDrawerCollapsedAtom(projectId)`), so it must (a) SURVIVE the route
// remount when the user switches asset-category tabs, and (b) stay ISOLATED
// between projects.
describe("ProjectWorkspace drawer-collapse persistence (I-A)", () => {
  // Render `ProjectWorkspace` under a CALLER-OWNED jotai store so a remount
  // (different category) or a sibling project (different projectId) can share
  // — or not share — the atom state exactly as production does. `key={category}`
  // makes a category change a real unmount→remount (matching the separate route
  // files in production), so `rerender` distinguishes the atom from a `useState`
  // that would also survive an in-place reconcile.
  function renderUnder(
    store: ReturnType<typeof createStore>,
    projectId: number,
    category: AssetCategory,
  ): {
    user: ReturnType<typeof userEvent.setup>;
    rerender: (c: AssetCategory) => void;
  } {
    const user = userEvent.setup();
    const ui = (cat: AssetCategory): React.JSX.Element => (
      <Provider store={store}>
        <QueryClientProvider client={new QueryClient()}>
          <ProjectWorkspace
            key={cat}
            projectId={projectId}
            category={cat}
            search={SEARCH}
            onSearchChange={vi.fn()}
          />
        </QueryClientProvider>
      </Provider>
    );
    const { rerender } = render(ui(category));
    return { user, rerender: (c) => rerender(ui(c)) };
  }

  it("keeps the drawer collapsed across a category-tab remount (same project)", async () => {
    const store = createStore();
    const { user, rerender } = renderUnder(store, 7, "all");

    await user.click(screen.getByRole("button", { name: "Collapse panel" }));
    expect(
      screen.queryByRole("region", { name: "Project details" }),
    ).not.toBeInTheDocument();

    // The `key` change unmounts the "all" workspace and mounts a fresh
    // "knowledge" one — a `useState(false)` would reset to expanded here; the
    // per-project atom holds the collapsed state in the jotai store, so it
    // survives the real remount.
    rerender("knowledge");
    expect(
      screen.queryByRole("region", { name: "Project details" }),
    ).not.toBeInTheDocument();
  });

  it("does NOT bleed collapse state across projects", async () => {
    const store = createStore();
    // Collapse project 7's drawer.
    const { user } = renderUnder(store, 7, "all");
    await user.click(screen.getByRole("button", { name: "Collapse panel" }));
    cleanup();

    // A different project under the SAME store opens expanded — its own atom
    // (keyed by projectId) is untouched.
    renderUnder(store, 8, "all");
    expect(
      screen.getByRole("region", { name: "Project details" }),
    ).toBeInTheDocument();
  });
});
