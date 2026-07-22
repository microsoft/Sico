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

import { toast } from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgeTags } from "@/features/projects/components/knowledge-tags";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import * as service from "@/features/projects/services/knowledge-tags";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/services/knowledge-tags");

const PROJECT_ID = 7;

function knowledgeTag(partial: Partial<KnowledgeTag> = {}): KnowledgeTag {
  return {
    id: 1,
    projectId: PROJECT_ID,
    name: "QA process",
    description: "Verify feature stability and identify edge cases.",
    creatorUsername: "alice",
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  };
}

function seed(items: KnowledgeTag[]): void {
  vi.mocked(service.fetchKnowledgeTags).mockResolvedValue({
    items,
    total: items.length,
    hasNext: false,
  });
}

function renderPage(): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // Seed the owning project so the breadcrumb's `useProjectDetailQuery`
  // resolves from cache (the harness's empty `apiClient` has no `.get`).
  queryClient.setQueryData(["projects", "detail", PROJECT_ID], {
    id: PROJECT_ID,
    name: "Demo Project",
    description: "",
    iconUrl: "",
    memberType: 1,
    agentInstances: [],
    ownerUsername: "alice",
    creatorUsername: "alice",
    operatorAdmins: [],
    createdAt: 1,
    updatedAt: 2,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <KnowledgeTags projectId={PROJECT_ID} />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(service.fetchKnowledgeTags).mockReset();
  seed([knowledgeTag()]);
  vi.mocked(service.deleteKnowledgeTag).mockResolvedValue(undefined);
});

describe("<KnowledgeTags>", () => {
  it("renders one row per knowledge tag with a non-navigating ··· menu", async () => {
    seed([
      knowledgeTag({ id: 1, name: "QA process" }),
      knowledgeTag({ id: 2, name: "Compliance" }),
    ]);
    renderPage();

    // Both knowledge tag names render as plain (non-interactive) text — the rows
    // never navigate, so the name is neither a link nor a button.
    expect(await screen.findByText("QA process")).toBeInTheDocument();
    expect(screen.getByText("Compliance")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: "QA process" })).toBeNull();

    // Each row exposes its own ··· actions trigger.
    expect(
      screen.getAllByRole("button", { name: "Knowledge tag actions" }),
    ).toHaveLength(2);
  });

  it("renders the empty state when there are no knowledge tags", async () => {
    seed([]);
    renderPage();

    expect(
      await screen.findByText("No knowledge tags yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Create a knowledge tag to organize your assets."),
    ).toBeInTheDocument();
    // The header Add button is still present on the empty state…
    expect(
      screen.getByRole("button", { name: "Add knowledge tag" }),
    ).toBeInTheDocument();
    // …but the empty state itself carries no table.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("opens the dialog in Add mode (empty Name) from the header button", async () => {
    const user = renderPage();
    await screen.findByText("QA process");

    await user.click(screen.getByRole("button", { name: "Add knowledge tag" }));

    expect(await screen.findByLabelText("Name")).toHaveValue("");
  });

  it("opens the dialog in Edit mode (pre-filled Name) from a row ··· menu", async () => {
    const user = renderPage();
    await screen.findByText("QA process");

    await user.click(
      screen.getByRole("button", { name: "Knowledge tag actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(await screen.findByLabelText("Name")).toHaveValue("QA process");
  });

  it("deletes via the confirm dialog then toasts", async () => {
    const user = renderPage();
    await screen.findByText("QA process");

    await user.click(
      screen.getByRole("button", { name: "Knowledge tag actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    // The shared confirm surfaces the knowledge-tag-specific copy.
    expect(
      await screen.findByText("Delete this knowledge tag?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(vi.mocked(service.deleteKnowledgeTag)).toHaveBeenCalledWith(
      expect.anything(),
      1,
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Knowledge tag deleted.", {
        invert: true,
      });
    });
  });

  it("toasts and keeps the confirm open when delete fails", async () => {
    vi.mocked(service.deleteKnowledgeTag).mockRejectedValue(new Error("nope"));
    const user = renderPage();
    await screen.findByText("QA process");

    await user.click(
      screen.getByRole("button", { name: "Knowledge tag actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't delete this knowledge tag. Try again.",
      );
    });
    // The confirm stays open for retry.
    expect(screen.getByText("Delete this knowledge tag?")).toBeInTheDocument();
  });
});
