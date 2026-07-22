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
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EditAssetDialog } from "@/features/projects/components/edit-asset-dialog";
import { useAssetMutation } from "@/features/projects/hooks/use-asset-mutation";
import {
  DocumentTypeSchema,
  ExtractionStatusSchema,
} from "@/features/projects/schemas/asset";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import * as knowledgeTagService from "@/features/projects/services/knowledge-tags";
import type { KnowledgeRow } from "@/features/projects/types";
import { ApiClientProvider } from "@/services/api-client-context";

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/hooks/use-asset-mutation", () => ({
  useAssetMutation: vi.fn(),
}));

vi.mock("@/features/projects/services/knowledge-tags");

const mockedUseAssetMutation = vi.mocked(useAssetMutation);

type EditMutation = ReturnType<typeof useAssetMutation>["edit"];

function mockMutation(overrides: Partial<EditMutation> = {}): EditMutation {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as EditMutation;
}

function mockHook(edit: EditMutation): void {
  mockedUseAssetMutation.mockReturnValue({
    edit,
    remove: mockMutation(),
  } as unknown as ReturnType<typeof useAssetMutation>);
}

const PROJECT_ID = 7;

function knowledge(partial: Partial<KnowledgeRow> = {}): KnowledgeRow {
  return {
    type: "knowledge",
    id: 101,
    name: "Transforming with AI innovation",
    documentType: DocumentTypeSchema.enum.FILE,
    status: ExtractionStatusSchema.enum.INGESTED,
    tags: [
      { id: 1, name: "Refunds" },
      { id: 2, name: "Onboarding" },
    ],
    creator: { kind: "user", username: "alice@microsoft.com" },
    createdAt: 0,
    ...partial,
  };
}

function knowledgeTag(id: number, name: string): KnowledgeTag {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    description: "",
    creatorUsername: "alice",
    createdAt: 1,
    updatedAt: 2,
  };
}

function seedKnowledgeTags(items: KnowledgeTag[]): void {
  vi.mocked(knowledgeTagService.fetchKnowledgeTags).mockResolvedValue({
    items,
    total: items.length,
    hasNext: false,
  });
}

function renderDialog(
  asset: KnowledgeRow = knowledge(),
  onOpenChange: (open: boolean) => void = vi.fn(),
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <Suspense fallback={<div>loading</div>}>
          <EditAssetDialog
            open
            onOpenChange={onOpenChange}
            projectId={PROJECT_ID}
            asset={asset}
          />
        </Suspense>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(knowledgeTagService.fetchKnowledgeTags).mockReset();
  seedKnowledgeTags([
    knowledgeTag(1, "Refunds"),
    knowledgeTag(2, "Onboarding"),
  ]);
  mockHook(mockMutation());
});

describe("<EditAssetDialog>", () => {
  it("pre-fills the name and shows the asset's tags as chips", async () => {
    renderDialog();

    expect(screen.getByLabelText("Knowledge name")).toHaveValue(
      "Transforming with AI innovation",
    );
    // Chips derive from matching the seeded ids (asset.tags.map(t => t.id) =
    // [1, 2]) against the knowledge tags list — their presence proves the seed.
    expect(
      await screen.findByRole("button", { name: "Remove Refunds" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Onboarding" }),
    ).toBeInTheDocument();
  });

  it("saves a renamed knowledge with the seeded tag ids, toasts, and closes", async () => {
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.(101));
    mockHook(mockMutation({ mutate }));
    const onOpenChange = vi.fn();
    const user = renderDialog(knowledge(), onOpenChange);

    await screen.findByRole("button", { name: "Remove Refunds" });

    const name = screen.getByLabelText("Knowledge name");
    await user.clear(name);
    await user.type(name, "Renamed doc");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          name: "Renamed doc",
          tagIds: [1, 2],
        }),
        expect.anything(),
      ),
    );
    expect(toast.success).toHaveBeenCalledWith("Your changes are saved.", {
      invert: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("blocks submit when the name is empty", async () => {
    const mutate = vi.fn();
    mockHook(mockMutation({ mutate }));
    const user = renderDialog();

    await screen.findByRole("button", { name: "Remove Refunds" });
    await user.clear(screen.getByLabelText("Knowledge name"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("drops a removed tag from the saved tag ids", async () => {
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.(101));
    mockHook(mockMutation({ mutate }));
    const user = renderDialog();

    await user.click(
      await screen.findByRole("button", { name: "Remove Refunds" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 101,
          name: "Transforming with AI innovation",
          tagIds: [2],
        }),
        expect.anything(),
      ),
    );
  });

  it("seeds empty tagIds when the asset has no tags", async () => {
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.(101));
    mockHook(mockMutation({ mutate }));
    const user = renderDialog(knowledge({ tags: [] }));

    // Wait for the suspending tag area to settle, then confirm no chips —
    // the empty seed must be [] (Number("") === 0 would wrongly seed [0]).
    await screen.findByRole("button", { name: "Add tag" });
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ id: 101, tagIds: [] }),
        expect.anything(),
      ),
    );
  });

  it("shows Saving… while the edit mutation is pending", async () => {
    mockHook(mockMutation({ isPending: true }));
    renderDialog();

    expect(
      await screen.findByRole("button", { name: "Saving…" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("surfaces the save-failure copy on mutation error", async () => {
    mockHook(mockMutation({ isError: true }));
    renderDialog();

    expect(
      await screen.findByText("We couldn't save your changes. Try again."),
    ).toBeInTheDocument();
  });
});
