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
import { createStore, Provider } from "jotai";
import { Suspense } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetDetail } from "@/features/projects/components/asset-detail";
import type { AssetDetail as AssetDetailData } from "@/features/projects/hooks/use-asset-detail-query";
import {
  DocumentTypeSchema,
  ExtractionStatusSchema,
  type PlaybookWire,
} from "@/features/projects/schemas/asset";
import type { KnowledgeTag } from "@/features/projects/schemas/knowledge-tag";
import {
  deleteDocument,
  deletePlaybook,
  editDocument,
} from "@/features/projects/services/asset-mutations";
import * as service from "@/features/projects/services/knowledge-tags";
import { ApiClientProvider } from "@/services/api-client-context";
import { downloadFile } from "@/utils/download-file";

const { navigateMock, historyBackMock, canGoBackMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  historyBackMock: vi.fn(),
  canGoBackMock: vi.fn(),
}));

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/services/asset-mutations");

vi.mock("@/features/projects/services/knowledge-tags");

vi.mock("@/utils/download-file", () => ({
  downloadFile: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-router", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useCanGoBack: () => canGoBackMock(),
    useRouter: () => ({ history: { back: historyBackMock } }),
    // useAssetDetailBack reads location.state to detect a notification entry;
    // stub a plain in-app location so the hook doesn't hit the real router.
    useLocation: () => ({ state: {} }),
  };
});

const PROJECT_ID = 7;
const ASSET_ID = 34;
// Local-time construction (not `Date.UTC`) so the epoch round-trips through
// `formatDateTime` — which formats in the viewer's LOCAL zone (by design) — back
// to the exact `2026-01-18 16:31` asserted below, in ANY timezone. A `Date.UTC`
// value only matched when the test host happened to run in UTC.
const CREATED_AT = new Date(2026, 0, 18, 16, 31).getTime();

function knowledge(
  partial: Partial<Extract<AssetDetailData, { type: "knowledge" }>> = {},
): AssetDetailData {
  return {
    type: "knowledge",
    id: 101,
    name: "Quarterly Report",
    documentType: DocumentTypeSchema.enum.FILE,
    status: ExtractionStatusSchema.enum.INGESTED,
    tags: [{ id: 1, name: "Refunds" }],
    creatorUsername: "Sarah Bennett",
    createdAt: CREATED_AT,
    attachment: {
      name: "Execution_Log.xlsx",
      sasUrl: "/storage/1/abc.xlsx",
    },
    summary: "A short summary of the document.",
    fullText: "Knowledge body text",
    ...partial,
  };
}

function experience(
  partial: Partial<Extract<AssetDetailData, { type: "experience" }>> = {},
): AssetDetailData {
  // Experience now resolves the playbook ROW (createdAt/projectId) + the
  // `/details` body together, so the fixture carries both — `content` from the
  // body, the rest from the row.
  return {
    type: "experience",
    ...playbookRow(),
    content: "Experience body text",
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

function seed(items: KnowledgeTag[]): void {
  vi.mocked(service.fetchKnowledgeTags).mockResolvedValue({
    items,
    total: items.length,
    hasNext: false,
  });
}

const PROJECT_NAME = "Demo Project";

// Seed the owning project into the cache so the breadcrumb's
// `useProjectDetailQuery` resolves synchronously (the harness's empty
// `apiClient` has no `.get`, so the query must never hit the network).
function seedProject(queryClient: QueryClient): void {
  queryClient.setQueryData(["projects", "detail", PROJECT_ID], {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    description: "",
    iconUrl: "",
    memberType: 1,
    agentInstances: [],
    ownerUsername: "alice",
    creatorUsername: "alice",
    operatorAdmins: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
}

// A playbook ROW (the eager `usePlaybookRowQuery` source) — carries `createdAt`
// for the Detail panel and `projectId` for the sync back-fallback. `agentInstance`
// is omitted (the single-row endpoint never sends it), so the panel's DW name
// falls back to the generic label.
function playbookRow(partial: Partial<PlaybookWire> = {}): PlaybookWire {
  return {
    id: ASSET_ID,
    name: "Playbook Alpha",
    projectId: PROJECT_ID,
    agentInstanceId: 4,
    tags: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...partial,
  };
}

function renderDetail(
  asset: AssetDetailData,
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  seedProject(queryClient);
  render(
    // Fresh jotai store per render so the global Detail-panel collapse atom
    // never bleeds across tests (it defaults to expanded).
    <Provider store={createStore()}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <Suspense fallback={<div>loading</div>}>
            <AssetDetail asset={asset} projectId={PROJECT_ID} />
          </Suspense>
        </ApiClientProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(service.fetchKnowledgeTags).mockReset();
  seed([knowledgeTag(1, "Refunds")]);
  vi.mocked(deleteDocument).mockResolvedValue(undefined);
  vi.mocked(deletePlaybook).mockResolvedValue(undefined);
  vi.mocked(editDocument).mockResolvedValue(101);
  // Default: there IS in-app history, so Back goes through history.back(). The
  // no-history fallback cases flip this per-test.
  canGoBackMock.mockReturnValue(true);
});

describe("<AssetDetail>", () => {
  it("renders a Knowledge body plus the right Detail panel", async () => {
    renderDetail(knowledge());

    // Left column: the markdown body (the title row was removed).
    expect(screen.getByText("Knowledge body text")).toBeInTheDocument();
    // Right panel resolves once the suspending tag area settles.
    expect(await screen.findByText("Knowledge tag")).toBeInTheDocument();
    expect(screen.getByText("Source file")).toBeInTheDocument();
    expect(screen.getByText("Created time")).toBeInTheDocument();
    expect(screen.getByText("Uploaded by Sarah Bennett")).toBeInTheDocument();
    // The Source file chip is a link to the uploaded blob's same-origin URL.
    const sourceLink = screen.getByRole("link", {
      name: /Execution_Log\.xlsx/,
    });
    expect(sourceLink).toHaveAttribute("href", "/storage/1/abc.xlsx");
    expect(sourceLink).toHaveAttribute("target", "_blank");
    expect(sourceLink).toHaveAttribute(
      "rel",
      expect.stringContaining("noopener"),
    );
  });

  it("links a LINK document's Source file to its linkUrl", async () => {
    renderDetail(
      knowledge({
        documentType: DocumentTypeSchema.enum.LINK,
        linkUrl: "https://docs.example.test",
        attachment: undefined,
      }),
    );

    await screen.findByText("Knowledge tag");
    const sourceLink = screen.getByRole("link", {
      name: /docs\.example\.test/,
    });
    expect(sourceLink).toHaveAttribute("href", "https://docs.example.test");
  });

  it("renders a javascript: linkUrl as a non-clickable chip (XSS gate)", async () => {
    // A stored javascript: URL must NOT become a live <a href> (it would run
    // on click). safeIconUri rejects the scheme, so the chip renders read-only.
    // eslint-disable-next-line no-script-url -- the exact XSS payload under test
    const payload = "javascript:alert(document.cookie)";
    renderDetail(
      knowledge({
        documentType: DocumentTypeSchema.enum.LINK,
        linkUrl: payload,
        attachment: undefined,
      }),
    );

    await screen.findByText("Knowledge tag");
    // The label still shows, but there is no anchor to click.
    expect(screen.getByText(payload)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders an Experience body with a title and the Detail panel", async () => {
    renderDetail(experience());

    // The eager row query suspends the whole tree, so wait for the panel first.
    expect(
      await screen.findByRole("region", { name: "Detail" }),
    ).toBeInTheDocument();
    // The markdown body renders (the title row was removed).
    expect(screen.getByText("Experience body text")).toBeInTheDocument();
    // Right panel: simple meta layout — real Created time (from the eager row),
    // em-dash DW placeholder, Operator placeholder. No knowledge-only affordances.
    expect(screen.getByText("2026-01-18 16:31")).toBeInTheDocument();
    expect(screen.getByText("Generated by —")).toBeInTheDocument();
    expect(screen.queryByText("Knowledge tag")).toBeNull();
    expect(screen.queryByText("Source file")).toBeNull();
  });

  it("collapses and restores the Experience Detail panel", async () => {
    const user = renderDetail(experience());

    await user.click(
      await screen.findByRole("button", { name: "Collapse panel" }),
    );
    expect(screen.queryByRole("region", { name: "Detail" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show panel" }));
    expect(screen.getByRole("region", { name: "Detail" })).toBeInTheDocument();
  });

  it("deletes the Experience from the ··· menu then navigates to the project", async () => {
    const user = renderDetail(experience());

    await user.click(
      await screen.findByRole("button", { name: "Asset actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(vi.mocked(deletePlaybook)).toHaveBeenCalledWith(
      expect.anything(),
      ASSET_ID,
    );
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/project/$projectId",
        params: { projectId: String(PROJECT_ID) },
      });
    });
  });

  it("titles the Experience delete confirm with the experience copy", async () => {
    const user = renderDetail(experience());

    await user.click(
      await screen.findByRole("button", { name: "Asset actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText("Delete Experience")).toBeInTheDocument();
  });

  it("opens the delete confirm from the Knowledge ··· menu", async () => {
    const user = renderDetail(knowledge());

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText("Delete Knowledge")).toBeInTheDocument();
  });

  it("downloads the uploaded file from the Knowledge ··· menu", async () => {
    const user = renderDetail(knowledge());

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Download" }));

    // The uploaded blob's same-origin SAS url + its real filename.
    expect(downloadFile).toHaveBeenCalledWith(
      "/storage/1/abc.xlsx",
      "Execution_Log.xlsx",
    );
  });

  it("omits Download for a LINK doc with no uploaded file", async () => {
    const user = renderDetail(
      knowledge({
        documentType: DocumentTypeSchema.enum.LINK,
        linkUrl: "https://docs.example.test",
        attachment: undefined,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    expect(
      screen.queryByRole("menuitem", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("collapses and restores the Knowledge Detail panel", async () => {
    const user = renderDetail(knowledge());

    // The shell renders immediately; the tag area inside it suspends separately.
    await user.click(screen.getByRole("button", { name: "Collapse panel" }));
    expect(screen.queryByRole("region", { name: "Detail" })).toBeNull();
    // Collapsing also hides the knowledge `…` actions (they live in the shell).
    expect(screen.queryByRole("button", { name: "Asset actions" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show panel" }));
    expect(screen.getByRole("region", { name: "Detail" })).toBeInTheDocument();
  });

  it("deletes via the confirm dialog then toasts and navigates to overview", async () => {
    const user = renderDetail(knowledge());

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(vi.mocked(deleteDocument)).toHaveBeenCalledWith(
      expect.anything(),
      101,
    );
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        '"Quarterly Report" was deleted.',
        { invert: true },
      );
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/project/$projectId",
      params: { projectId: String(PROJECT_ID) },
    });
  });

  it("toasts when the delete mutation fails", async () => {
    vi.mocked(deleteDocument).mockRejectedValue(new Error("nope"));
    const user = renderDetail(knowledge());

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't delete this. Try again.",
      );
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("retags via the edit mutation when a tag chip is removed", async () => {
    const user = renderDetail(knowledge());

    await user.click(
      await screen.findByRole("button", { name: "Remove Refunds" }),
    );

    await waitFor(() => {
      expect(vi.mocked(editDocument)).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 101, tagIds: [] }),
      );
    });
  });

  it("follows fresh server tags on re-render (no stale local mirror)", async () => {
    seed([knowledgeTag(1, "Refunds"), knowledgeTag(2, "Billing")]);
    const apiClient = {} as AxiosInstance;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    seedProject(queryClient);
    const tree = (asset: AssetDetailData): ReactElement => (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <Suspense fallback={<div>loading</div>}>
            <AssetDetail asset={asset} projectId={PROJECT_ID} />
          </Suspense>
        </ApiClientProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(
      tree(knowledge({ tags: [{ id: 1, name: "Refunds" }] })),
    );
    expect(await screen.findByText("Refunds")).toBeInTheDocument();

    // The route re-renders the SAME mounted component (param-only nav never
    // remounts it) with the canonical server tags. The panel must track
    // `asset.tags`, not a one-time mount snapshot.
    rerender(tree(knowledge({ tags: [{ id: 2, name: "Billing" }] })));

    expect(await screen.findByText("Billing")).toBeInTheDocument();
    expect(screen.queryByText("Refunds")).toBeNull();
  });

  it("drops the tag area on load failure while keeping the rest of the panel", async () => {
    // The tag area suspends on `useKnowledgeTagsQuery` (useSuspenseQuery → throws
    // on failure). It is a secondary inline field, so its boundary renders
    // nothing on failure (NOT the page-level ErrorView) — only the tag area
    // drops out while the rest of the Detail panel keeps rendering.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(service.fetchKnowledgeTags).mockRejectedValue(new Error("boom"));
    renderDetail(knowledge());

    // The rest of the Detail panel still renders…
    expect(await screen.findByText("Source file")).toBeInTheDocument();
    expect(screen.getByText("Created time")).toBeInTheDocument();
    expect(screen.getByText("Uploaded by Sarah Bennett")).toBeInTheDocument();
    // …but the failed tag area shows neither its label nor a page-level error.
    expect(screen.queryByText("Knowledge tag")).toBeNull();
    expect(
      screen.queryByText("Something went wrong on this page. Try again."),
    ).toBeNull();
    spy.mockRestore();
  });

  it("toasts when an inline retag fails", async () => {
    vi.mocked(editDocument).mockRejectedValue(new Error("nope"));
    const user = renderDetail(knowledge());

    await user.click(
      await screen.findByRole("button", { name: "Remove Refunds" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "We couldn't update tags. Try again.",
      );
    });
  });

  it("Knowledge Back goes through history when there is in-app history", async () => {
    canGoBackMock.mockReturnValue(true);
    const user = renderDetail(knowledge());

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(historyBackMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("Knowledge Back falls back to the project page when there is no history", async () => {
    canGoBackMock.mockReturnValue(false);
    const user = renderDetail(knowledge());

    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/project/$projectId",
        params: { projectId: String(PROJECT_ID) },
      });
    });
    expect(historyBackMock).not.toHaveBeenCalled();
  });

  it("Experience Back goes through history when there is in-app history", async () => {
    canGoBackMock.mockReturnValue(true);
    const user = renderDetail(experience());

    // Wait for the eager row query to settle (panel mounted) before clicking.
    await screen.findByRole("region", { name: "Detail" });
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(historyBackMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("Experience Back falls back to the project page when there is no history", async () => {
    // Nested under `$projectId`, so the projectId is in hand — the fallback
    // navigates there synchronously, no playbook lookup.
    canGoBackMock.mockReturnValue(false);
    const user = renderDetail(experience());

    await screen.findByRole("region", { name: "Detail" });
    await user.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/project/$projectId",
        params: { projectId: String(PROJECT_ID) },
      });
    });
    expect(historyBackMock).not.toHaveBeenCalled();
  });
});
