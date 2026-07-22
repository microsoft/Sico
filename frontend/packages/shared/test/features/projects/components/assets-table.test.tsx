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

import { toast, TooltipProvider } from "@sico/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AssetsTable } from "@/features/projects/components/assets-table";
import { useAssetMutation } from "@/features/projects/hooks/use-asset-mutation";
import {
  useAssetsInfiniteQuery,
  type UseAssetsQueryResult,
  useSuspenseAssetsInfiniteQuery,
} from "@/features/projects/hooks/use-assets-query";
import {
  DocumentTypeSchema,
  ExtractionStatusSchema,
} from "@/features/projects/schemas/asset";
import type { AssetSearch } from "@/features/projects/schemas/asset-search";
import type {
  AssetCategory,
  AssetRow as AssetRowData,
} from "@/features/projects/types";
import {
  ASSETS_HINT_DISMISSED_LS,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
} from "@/utils/local-storage";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@/features/projects/hooks/use-assets-query");

vi.mock("@/features/projects/hooks/use-asset-mutation", () => ({
  useAssetMutation: vi.fn(),
}));

// The row-click handler reads `useNavigate`; the category Tabs render `<Link>`s.
// Without a real router both throw, so stub `useNavigate` to a spy and `Link` to
// a plain anchor that exposes its `to` (the category path) as the href and
// forwards the role/styling props Base UI's TabsTrigger injects — enough to
// assert the tab targets without mounting a RouterProvider. Named props (no
// spread) mirror sidebar.test.tsx.
vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({
      to,
      params,
      children,
      role,
      className,
      id,
    }: {
      to: string;
      params?: { projectId: string };
      children?: React.ReactNode;
      role?: string;
      className?: string;
      id?: string;
    }): React.JSX.Element => (
      <a
        href={params ? to.replace("$projectId", params.projectId) : to}
        role={role}
        className={className}
        id={id}
      >
        {children}
      </a>
    ),
  };
});

// The real EditAssetDialog suspends on `useKnowledgeTagsQuery` and needs an
// ApiClientProvider; this table test only proves the WIRING (it opens with the
// right asset), so stub it to a probe (mirrors the edit dialog's own mock
// pattern of keeping the focus on behaviour, not internals).
vi.mock("@/features/projects/components/edit-asset-dialog", () => ({
  EditAssetDialog: ({
    open,
    asset,
  }: {
    open: boolean;
    asset: { name: string };
  }): React.JSX.Element | null =>
    open ? <div>edit-dialog:{asset.name}</div> : null,
}));

// Partial-mock @sico/ui: stub `toast` (the extraction-result effect surfaces a
// batch summary through `success`/`error`; the delete flow toasts through
// `success`) while keeping every other export real so
// Tabs/Table/InputGroup/TooltipProvider/Dialog still render. Mirrors
// composer.test.tsx.
vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return {
    ...actual,
    toast: { error: vi.fn(), success: vi.fn() },
  };
});

const mockedToastError = vi.mocked(toast.error);
const mockedToastSuccess = vi.mocked(toast.success);
const mockedUseAssetMutation = vi.mocked(useAssetMutation);

type RemoveMutation = ReturnType<typeof useAssetMutation>["remove"];

// Minimal react-query mutation stand-in (mirrors edit-asset-dialog.test.tsx).
function mockMutation(overrides: Partial<RemoveMutation> = {}): RemoveMutation {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  } as unknown as RemoveMutation;
}

// Seat `remove` (the mutation under test) on the hook; `edit` is unused here.
function mockHook(remove: RemoveMutation): void {
  mockedUseAssetMutation.mockReturnValue({
    edit: mockMutation(),
    remove,
  } as unknown as ReturnType<typeof useAssetMutation>);
}

// Mirrors the component's module-private schema (it is not exported); used to
// seed + read the dismissed-hint set through the safe localStorage helpers.
const hintSchema = z.array(z.enum(["deliverable", "experience"]));

const doc = DocumentTypeSchema.enum;
const status = ExtractionStatusSchema.enum;

function makeKnowledge(
  partial: Partial<Extract<AssetRowData, { type: "knowledge" }>> = {},
): AssetRowData {
  return {
    type: "knowledge",
    id: 101,
    name: "Transforming with AI innovation",
    documentType: doc.FILE,
    status: status.INGESTED,
    tags: [],
    creator: { kind: "user", username: "Sarah Baker" },
    createdAt: 1000,
    ...partial,
  };
}

function makeExperience(
  partial: Partial<Extract<AssetRowData, { type: "experience" }>> = {},
): AssetRowData {
  return {
    type: "experience",
    id: 202,
    name: "Playbook Alpha",
    projectId: 1,
    tags: [],
    creator: { kind: "agent", agentInstanceId: 7 },
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

function makeDeliverable(
  partial: Partial<Extract<AssetRowData, { type: "deliverable" }>> = {},
): AssetRowData {
  return {
    type: "deliverable",
    id: 303,
    name: "report.md",
    createdAt: 1000,
    fileSasUrl: "https://sas/report.md",
    creator: { kind: "agent", agentInstanceId: 7, agentName: "Max" },
    ...partial,
  };
}

// Suspense's signal is a thrown thenable that never settles, so the inner rows
// stay suspended and the bare-skeleton fallback holds for the assertion.
const NEVER_SETTLES = new Promise<never>(() => {});

// The DATA surface (`AssetsTableRows`). Resolved: one page of `rows`. The two
// non-happy states are modelled as the suspense hook itself suspends (throws the
// pending thenable) or throws — exactly what a cold load / failed query do, so
// the shell's `<Suspense>` / `<ErrorBoundary>` take over.
function mockRows(rows: AssetRowData[]): void {
  vi.mocked(useSuspenseAssetsInfiniteQuery).mockReturnValue({
    data: { pages: [{ items: rows, total: rows.length, hasNext: false }] },
  } as unknown as ReturnType<typeof useSuspenseAssetsInfiniteQuery>);
}

function mockRowsSuspend(): void {
  vi.mocked(useSuspenseAssetsInfiniteQuery).mockImplementation(() => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- React Suspense suspends by throwing a thenable
    throw NEVER_SETTLES;
  });
}

function mockRowsError(): void {
  vi.mocked(useSuspenseAssetsInfiniteQuery).mockImplementation(() => {
    throw new Error("assets failed");
  });
}

// The SENTINEL surface (`AssetsTable` shell): the non-suspense pager that feeds
// the infinite-scroll sentinel + "loading more" skeleton rows. A complete
// `UseAssetsQueryResult`, so no cast is needed.
function mockPager(overrides: Partial<UseAssetsQueryResult> = {}): void {
  vi.mocked(useAssetsInfiniteQuery).mockReturnValue({
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  });
}

function Wrapper({
  category,
  search,
  onSearchChange,
}: {
  category: AssetCategory;
  search: AssetSearch;
  onSearchChange: (next: Partial<AssetSearch>) => void;
}): React.JSX.Element {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider delayDuration={0}>
        <AssetsTable
          projectId={1}
          category={category}
          search={search}
          onSearchChange={onSearchChange}
          onAddKnowledge={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function renderTable(
  options: { category?: AssetCategory } & Partial<AssetSearch> = {},
): {
  onSearchChange: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const { category = "all", ...searchOverrides } = options;
  const onSearchChange = vi.fn();
  const search: AssetSearch = { sort: "desc", q: "", ...searchOverrides };
  const { unmount } = render(
    <Wrapper
      category={category}
      search={search}
      onSearchChange={onSearchChange}
    />,
  );
  return { onSearchChange, unmount };
}

// The experience-tab hint description (§5 `assets.hint.experience`). The bar
// renders a bold "Experience:" label + this description as separate nodes; the
// description text node resolves to its own <p> under getByText.
const EXPERIENCE_HINT = "Reusable patterns accumulated through execution.";

// The fixture names whose rendered DOM order proves the sort was applied.
const ORDER_NAMES = ["Alpha", "Beta", "Gamma"] as const;

// One name per body <tr> (the header row carries none), so reading each row's
// text in DOM order yields the rendered sort order.
function renderedOrder(): string[] {
  return screen
    .getAllByRole("row")
    .map((row) => ORDER_NAMES.find((name) => row.textContent.includes(name)))
    .filter((name): name is (typeof ORDER_NAMES)[number] => name !== undefined);
}

beforeEach(() => {
  // Reset both query surfaces so a prior test's `mockImplementation` (suspend /
  // throw) never leaks into the next test's default.
  vi.mocked(useSuspenseAssetsInfiniteQuery).mockReset();
  vi.mocked(useAssetsInfiniteQuery).mockReset();
  mockRows([]);
  mockPager();
  mockHook(mockMutation());
  // The infinite-scroll sentinel constructs an IntersectionObserver; jsdom has
  // none, so stub a no-op (this suite doesn't drive intersection — pagination
  // wiring is covered in use-assets-query.test.tsx).
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

describe("<AssetsTable>", () => {
  it("renders the Knowledge tab as a link to its category path", () => {
    mockRows([makeKnowledge()]);
    renderTable();

    // The category tabs are router links now (path-driven), not local-state
    // toggles — the Knowledge tab targets `/project/1/knowledge`.
    expect(screen.getByRole("tab", { name: "Knowledge" })).toHaveAttribute(
      "href",
      "/project/1/knowledge",
    );
  });

  it("toggling the CREATED TIME header (desc) fires onSearchChange({ sort: 'asc' })", async () => {
    const user = userEvent.setup();
    mockRows([makeExperience()]);
    const { onSearchChange } = renderTable({
      category: "experience",
      sort: "desc",
    });

    await user.click(screen.getByRole("button", { name: /created time/i }));

    expect(onSearchChange).toHaveBeenCalledWith({ sort: "asc" });
  });

  // The column-header row sticks to the top of the scroll card so labels stay
  // visible while the body scrolls. It needs an opaque fill (or the scrolling
  // rows show through) and a z-index above the body's pinned cells (z-10) and
  // the pinned header cells (z-20).
  it("sticks the column-header row to the top of the scroll card", () => {
    mockRows([makeExperience()]);
    renderTable({ category: "experience" });

    const headerRow = screen
      .getByRole("columnheader", { name: "ASSET NAME" })
      .closest("tr");
    expect(headerRow).toHaveClass(
      "sticky",
      "top-0",
      "z-30",
      "bg-surface-basic",
    );
  });

  it("renders rows in the order dictated by search.sort (asc vs desc reverse)", () => {
    // Input is deliberately NOT pre-sorted, so the asc branch must actively
    // reorder it (not merely pass an already-ascending list through).
    const rows = [
      makeExperience({ id: 2, name: "Beta", createdAt: 200 }),
      makeExperience({ id: 1, name: "Alpha", createdAt: 100 }),
      makeExperience({ id: 3, name: "Gamma", createdAt: 300 }),
    ];

    mockRows(rows);
    const { unmount } = renderTable({ category: "experience", sort: "asc" });
    const ascOrder = renderedOrder();
    unmount();

    mockRows(rows);
    renderTable({ category: "experience", sort: "desc" });
    const descOrder = renderedOrder();

    expect(ascOrder).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(descOrder).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("a query that matches nothing renders the search-empty copy", () => {
    mockRows([makeKnowledge({ name: "Quarterly report" })]);
    renderTable({ q: "zzz" });

    expect(
      screen.getByText('No assets match "zzz". Try a different search.'),
    ).toBeInTheDocument();
  });

  it("a failed rows query throws to the in-card ErrorView", () => {
    // React logs the boundary-caught error; silence it so the suite output stays
    // clean (mirrors asset-detail.test.tsx's tag-area failure case).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRowsError();
    renderTable();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    spy.mockRestore();
  });

  it("a cold load suspends to the loading skeleton", () => {
    mockRowsSuspend();
    renderTable();

    expect(
      screen.getByRole("status", { name: "Loading assets" }),
    ).toBeInTheDocument();
  });

  it("appends content-shaped skeleton rows while fetching the next page", () => {
    mockRows([makeKnowledge()]);
    mockPager({ hasNextPage: true, isFetchingNextPage: true });
    renderTable();

    expect(screen.getAllByTestId("assets-table-loading-more-row")).toHaveLength(
      3,
    );
  });

  it("shows the experience definition hint on the Experience category", () => {
    renderTable({ category: "experience" });

    expect(screen.getByText(EXPERIENCE_HINT)).toBeInTheDocument();
  });

  it("dismissing the hint hides it and persists the category to localStorage", async () => {
    const user = userEvent.setup();
    renderTable({ category: "experience" });

    await user.click(screen.getByRole("button", { name: "Don't show again" }));

    expect(screen.queryByText(EXPERIENCE_HINT)).toBeNull();
    expect(
      safeGetItemFromLocalStorage(ASSETS_HINT_DISMISSED_LS, hintSchema),
    ).toContain("experience");
  });

  // The dismiss (×) sits in its OWN pinned-right cell aligned to the ACTIONS
  // column, not floated to the edge of a full-span cell — so it lines up with
  // the row menu and, being sticky, never scrolls out of view when the table
  // is narrow enough to scroll horizontally.
  it("puts the hint dismiss in a pinned-right cell aligned to the ACTIONS column", () => {
    renderTable({ category: "experience" });

    const cell = screen
      .getByRole("button", { name: "Don't show again" })
      .closest("td");
    expect(cell).toHaveClass("sticky", "right-0", "w-11");
  });

  // Regression: the pinned dismiss cell must inherit the row's fill, not paint
  // its own. `PIN_RIGHT` carries `bg-inherit`, so the sunken tint has to live on
  // the ROW (an opaque resting background to inherit) — otherwise the pinned
  // cell falls through to the table's white and the hint bar reads half-grey,
  // half-white at rest. The hint is non-interactive, so the row also pins its
  // hover fill to the same sunken tint (cancelling TableRow's `hover:bg-primary-50`).
  it("carries the sunken fill on the hint row so the pinned dismiss cell inherits it", () => {
    renderTable({ category: "experience" });

    const cell = screen
      .getByRole("button", { name: "Don't show again" })
      .closest("td");
    const row = cell?.closest("tr");
    expect(row).toHaveClass("bg-surface-sunken", "hover:bg-surface-sunken");
    expect(cell).toHaveClass("bg-inherit");
  });

  it("does not show the hint when the category is already dismissed in localStorage", () => {
    safeSetItemToLocalStorage(ASSETS_HINT_DISMISSED_LS, hintSchema, [
      "experience",
    ]);
    renderTable({ category: "experience" });

    expect(screen.queryByText(EXPERIENCE_HINT)).toBeNull();
  });

  it("shows the hint inside the card on an empty hinted category (Deliverable with no rows)", () => {
    // An empty Deliverable category still shows its hint: the card shell carries
    // the header + hint bar with the empty state nested inside it.
    mockRows([]);
    renderTable({ category: "deliverable" });

    expect(
      screen.getByText("Artifacts produced by digital workers."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Deliverables will appear here once your digital workers publish them.",
      ),
    ).toBeInTheDocument();
  });

  it("cancels the injected table-container flex-1 when empty so the empty state centers", () => {
    // Regression: the scroll card injects flex-1 onto every table-container. With
    // no rows the header+hint table would split the column height 50/50 with the
    // empty state and push it below center — the shell adds flex-none to shrink
    // the table and hand the rest to the centered empty state.
    mockRows([]);
    renderTable({ category: "deliverable" });

    expect(screen.getByTestId("assets-table-shell")).toHaveClass(
      "[&_[data-slot=table-container]]:flex-none",
    );
  });

  it("does not cancel the table-container flex-1 when rows are present", () => {
    mockRows([makeKnowledge()]);
    renderTable();

    expect(screen.getByTestId("assets-table-shell")).not.toHaveClass(
      "[&_[data-slot=table-container]]:flex-none",
    );
  });

  it("clicking a navigable knowledge row navigates to its detail route", async () => {
    const user = userEvent.setup();
    mockRows([makeKnowledge({ id: 101 })]);
    renderTable();

    await user.click(
      screen.getByRole("button", { name: "Transforming with AI innovation" }),
    );

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId/knowledge/$assetId",
      params: { projectId: "1", assetId: "101" },
    });
  });

  it("clicking a deliverable row navigates to its detail route", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    // A deliverable now opens a full-page preview (FilePreview), like knowledge —
    // it no longer opens the raw file in a new tab.
    mockRows([makeDeliverable({ id: 303, name: "Quarterly deck" })]);
    renderTable({ category: "deliverable" });

    await user.click(screen.getByRole("button", { name: "Quarterly deck" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId/deliverable/$assetId",
      params: { projectId: "1", assetId: "303" },
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("the Experience category renders the ACTIONS column with a Delete menu", async () => {
    const user = userEvent.setup();
    mockRows([makeExperience()]);
    renderTable({ category: "experience" });

    // Experience now has a Delete action, so the ACTIONS column is shown and the
    // row carries its `···` menu. The header cell stays labelled "Actions" for
    // accessibility even though its glyph was removed.
    expect(
      screen.getByRole("columnheader", { name: "Actions" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Delete"]);
  });

  it("an experience's ··· Delete confirms with the Experience title, then fires remove.mutate", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
    mockHook(mockMutation({ mutate }));
    mockRows([makeExperience({ id: 202, name: "Playbook Alpha" })]);
    renderTable({ category: "experience" });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("Delete Experience")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mutate).toHaveBeenCalledWith(
      { id: 202, type: "experience" },
      expect.anything(),
    );
  });

  it("a deliverable's ··· Delete confirms with the Deliverable title, then fires remove.mutate", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn((_vars, opts) => opts?.onSuccess?.());
    mockHook(mockMutation({ mutate }));
    mockRows([makeDeliverable({ id: 303, name: "report.md" })]);
    renderTable({ category: "deliverable" });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("Delete Deliverable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mutate).toHaveBeenCalledWith(
      { id: 303, type: "deliverable" },
      expect.anything(),
    );
  });

  it("a deliverable's ··· Download saves its published file", async () => {
    const user = userEvent.setup();
    // downloadFile builds a transient <a download> and clicks it; spy on the
    // anchor click to prove the full asset-row → handleAction → downloadFile
    // wiring fires for a deliverable (its cross-origin fileSasUrl).
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    mockRows([makeDeliverable({ fileSasUrl: "https://sas/report.md" })]);
    renderTable({ category: "deliverable" });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Download" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it("the ··· Edit action opens the edit dialog for that row", async () => {
    const user = userEvent.setup();
    mockRows([makeKnowledge({ name: "Refund policy" })]);
    renderTable();

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(screen.getByText("edit-dialog:Refund policy")).toBeInTheDocument();
  });

  it("the ··· Delete action confirms, fires remove.mutate, then toasts on success", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn((_id, opts) => opts?.onSuccess?.());
    mockHook(mockMutation({ mutate }));
    mockRows([makeKnowledge({ id: 101, name: "Refund policy" })]);
    renderTable();

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("Delete Knowledge")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mutate).toHaveBeenCalledWith(
      { id: 101, type: "knowledge" },
      expect.anything(),
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        '"Refund policy" was deleted.',
        { invert: true },
      );
    });
  });

  it("clicking a link row opens a safe link URL in a new tab", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    mockRows([
      makeKnowledge({
        documentType: doc.LINK,
        linkUrl: "https://docs.example.test",
      }),
    ]);
    renderTable();

    // A link has no detail page, so activating the row opens the URL (the menu
    // no longer carries an Open link item).
    await user.click(
      screen.getByRole("button", { name: "Transforming with AI innovation" }),
    );

    expect(openSpy).toHaveBeenCalledWith(
      "https://docs.example.test",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("clicking a link row drops an unsafe (javascript:) link URL", async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    // Built from the scheme so the literal never reads as a `javascript:` URL
    // (ESLint's no-script-url flags such literals); the row carries the unsafe
    // scheme that safeIconUri must reject.
    const scheme = "javascript";
    mockRows([
      makeKnowledge({ documentType: doc.LINK, linkUrl: `${scheme}:1` }),
    ]);
    renderTable();

    await user.click(
      screen.getByRole("button", { name: "Transforming with AI innovation" }),
    );

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  // Re-rendering with a freshly-mocked `useSuspenseAssetsInfiniteQuery`
  // simulates a poll tick: the hook returns new rows and
  // `useExtractionResultToast` compares them to the snapshot it took on the
  // previous render.
  function renderPoll(): {
    rerender: () => void;
    onSearchChange: ReturnType<typeof vi.fn>;
  } {
    const onSearchChange = vi.fn();
    const search: AssetSearch = { sort: "desc", q: "" };
    const { rerender } = render(
      <Wrapper
        category="all"
        search={search}
        onSearchChange={onSearchChange}
      />,
    );
    return {
      rerender: () =>
        rerender(
          <Wrapper
            category="all"
            search={search}
            onSearchChange={onSearchChange}
          />,
        ),
      onSearchChange,
    };
  }

  it("toasts one success summary once an extracting row settles to INGESTED", () => {
    mockRows([makeKnowledge({ id: 1, status: status.UPLOADED })]);
    const { rerender } = renderPoll();
    expect(mockedToastSuccess).not.toHaveBeenCalled();

    mockRows([makeKnowledge({ id: 1, status: status.INGESTED })]);
    rerender();

    expect(mockedToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockedToastSuccess).toHaveBeenCalledWith(
      "Extraction complete — 1 added.",
    );
  });

  it("toasts a failure summary when an extracting row settles to FAILED", () => {
    mockRows([makeKnowledge({ id: 1, status: status.UPLOADED })]);
    const { rerender } = renderPoll();

    mockRows([makeKnowledge({ id: 1, status: status.FAILED })]);
    rerender();

    expect(mockedToastError).toHaveBeenCalledWith(
      "Extraction failed for 1 item(s).",
    );
  });

  it("summarizes a mixed batch into a single toast", () => {
    mockRows([
      makeKnowledge({ id: 1, status: status.UPLOADED }),
      makeKnowledge({ id: 2, status: status.UPLOADED }),
    ]);
    const { rerender } = renderPoll();

    mockRows([
      makeKnowledge({ id: 1, status: status.INGESTED }),
      makeKnowledge({ id: 2, status: status.FAILED }),
    ]);
    rerender();

    expect(mockedToastError).toHaveBeenCalledTimes(1);
    expect(mockedToastError).toHaveBeenCalledWith(
      "Extraction finished — 1 added, 1 failed.",
    );
    expect(mockedToastSuccess).not.toHaveBeenCalled();
  });

  it("never toasts for rows that were already settled on first paint", () => {
    mockRows([makeKnowledge({ id: 1, status: status.INGESTED })]);
    const { rerender } = renderPoll();
    rerender();

    expect(mockedToastSuccess).not.toHaveBeenCalled();
    expect(mockedToastError).not.toHaveBeenCalled();
  });
});

// C1/C2 regression: the infinite-scroll sentinel + scroll card stay MOUNTED
// across every query state, so the once-only IntersectionObserver effect
// attaches even on a COLD load (where the inner rows are still SUSPENDED and the
// first paint is the bare skeleton). Before the fix the sentinel lived only in
// the rows branch, so it wasn't in the DOM when the observer effect ran →
// pagination never started on first visit.
describe("<AssetsTable> infinite-scroll sentinel (C1/C2)", () => {
  // A capturing IntersectionObserver stub: records the observed node and the
  // callback so the test can both assert attachment and drive an intersection.
  type Captured = {
    callback: IntersectionObserverCallback;
    observed: Element[];
    root: Element | Document | null;
  };
  let captured: Captured | null;

  beforeEach(() => {
    captured = null;
    mockHook(mockMutation());
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observed: Element[] = [];
        constructor(
          public callback: IntersectionObserverCallback,
          public options?: IntersectionObserverInit,
        ) {
          captured = {
            callback,
            observed: this.observed,
            root: options?.root ?? null,
          };
        }

        observe(node: Element): void {
          this.observed.push(node);
        }

        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  it("attaches the observer to the sentinel while the inner rows are SUSPENDED", () => {
    // Cold load: the inner rows suspend (bare skeleton shows) — but the sentinel
    // + scroll card live in the persistent shell OUTSIDE the boundary, so the
    // once-only observer effect still finds the node on the first commit.
    mockRowsSuspend();
    mockPager({ hasNextPage: false });
    renderTable();

    // The inner is genuinely suspended (the bare skeleton owns the live region)…
    expect(
      screen.getByRole("status", { name: "Loading assets" }),
    ).toBeInTheDocument();
    // …yet the shell's sentinel is observed all the same.
    expect(captured).not.toBeNull();
    expect(captured?.observed).toHaveLength(1);
    // C2: the observer roots on the bounded scroll CARD, not the viewport — and
    // the observed sentinel lives INSIDE that card (the card is its ancestor).
    const root = captured?.root;
    const sentinel = captured?.observed[0];
    // `instanceof` narrows (unlike `toBeInstanceOf`), so no `as` cast is needed
    // to reach `toContainElement` / the DOM `Element` API.
    if (!(root instanceof HTMLElement) || !(sentinel instanceof HTMLElement)) {
      throw new Error("observer root and sentinel must both be HTMLElements");
    }
    expect(root).toContainElement(sentinel);
  });

  it("an intersection during a COLD load (no next page) is a safe no-op", () => {
    // The sentinel is mounted from first paint, so the observer can fire while
    // the rows still suspend. With `hasNextPage` false it must NOT fetch —
    // otherwise a cold load would pull page 2 before page 1 even resolved.
    const fetchNextPage = vi.fn();
    mockRowsSuspend();
    mockPager({ hasNextPage: false, fetchNextPage });
    renderTable();

    act(() => {
      captured?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("an intersection while hasNextPage triggers fetchNextPage", () => {
    const fetchNextPage = vi.fn();
    mockRows([makeKnowledge()]);
    mockPager({
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    });
    renderTable();

    const entry = captured;
    expect(entry).not.toBeNull();
    // Drive the sentinel into view — the observer callback should pull the next
    // page (this is the path that was dead before the cold-load fix).
    act(() => {
      entry?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(fetchNextPage).toHaveBeenCalled();
  });
});
