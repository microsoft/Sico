import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosInstance } from "axios";
import { createStore, Provider } from "jotai";
import { type ReactElement, Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetDetailDeliverable } from "@/features/projects/components/asset-detail-deliverable";
import type { AssetDetail } from "@/features/projects/hooks/use-asset-detail-query";
import { deleteDeliverable } from "@/features/projects/services/asset-mutations";
import { ApiClientProvider } from "@/services/api-client-context";
import { downloadFile } from "@/utils/download-file";

const { navigateMock, historyBackMock, canGoBackMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  historyBackMock: vi.fn(),
  canGoBackMock: vi.fn(() => false),
}));

vi.mock("@sico/ui", async (importActual) => {
  const actual = await importActual<typeof import("@sico/ui")>();
  return { ...actual, toast: { success: vi.fn(), error: vi.fn() } };
});

vi.mock("@/features/projects/services/asset-mutations");
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

// The deliverable asset as the dispatcher hands it to the component (the route's
// `useAssetDetailQuery` already resolved it — the component no longer fetches).
type DeliverableDetail = Extract<AssetDetail, { type: "deliverable" }>;

const sampleDeliverable: DeliverableDetail = {
  type: "deliverable",
  id: 7,
  projectId: 9,
  fileName: "report.md",
  fileUri: "default_space/0/report.md",
  fileSasUrl: "https://sas/report.md",
  creatorUsername: "alice",
  agentInstanceId: 4,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
  extraInfo: { agentInstance: { agentName: "Max", agentIconUrl: "/i.svg" } },
};

function renderContent(
  asset: DeliverableDetail = sampleDeliverable,
): ReturnType<typeof render> {
  const apiClient = {} as AxiosInstance;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Seed the owning project so the breadcrumb's `useProjectDetailQuery`
  // resolves from cache (the harness's empty `apiClient` has no `.get`).
  queryClient.setQueryData(["projects", "detail", 9], {
    id: 9,
    name: "Demo Project",
    description: "",
    iconUrl: "",
    memberType: 1,
    agentInstances: [],
    ownerUsername: "alice",
    creatorUsername: "alice",
    operatorAdmins: [],
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  });
  const ui: ReactElement = (
    <AssetDetailDeliverable asset={asset} projectId={9} />
  );
  return render(
    // Fresh jotai store per render so the global collapse atom never bleeds
    // across tests (the panel defaults to expanded).
    <Provider store={createStore()}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={apiClient}>
          <Suspense fallback={null}>{ui}</Suspense>
        </ApiClientProvider>
      </QueryClientProvider>
    </Provider>,
  );
}

beforeEach(() => {
  vi.mocked(deleteDeliverable).mockReset();
  vi.mocked(deleteDeliverable).mockResolvedValue(undefined);
  navigateMock.mockReset();
  vi.mocked(downloadFile).mockClear();
  // FilePreview's markdown viewer fetches the file body; a never-settling stub
  // keeps it in its loading state without a real round-trip.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

describe("AssetDetailDeliverable", () => {
  it("renders the file body for the deliverable (md → markdown viewer)", async () => {
    renderContent();
    // FilePreview dispatches a `.md` url to the markdown file viewer.
    expect(await screen.findByTestId("file-markdown")).toBeInTheDocument();
  });

  it("downloads the deliverable from the Detail ··· menu", async () => {
    const user = userEvent.setup();
    renderContent();
    await user.click(
      await screen.findByRole("button", { name: "Asset actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Download" }));
    expect(downloadFile).toHaveBeenCalledWith(
      "https://sas/report.md",
      "report.md",
    );
  });

  it("shows an unavailable state and omits Download when the file url is missing", async () => {
    const user = userEvent.setup();
    renderContent({ ...sampleDeliverable, fileSasUrl: null });
    expect(await screen.findByText(/isn't available/i)).toBeInTheDocument();
    // No file → no preview and no Download menu item (Delete stays available).
    expect(screen.queryByTestId("file-markdown")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    expect(
      screen.queryByRole("menuitem", { name: "Download" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  it("fills and vertically centers the unavailable state within the card", async () => {
    renderContent({ ...sampleDeliverable, fileSasUrl: null });
    // Must grow to fill the card and center its content — otherwise the state
    // sits flush under the title row instead of centered (matches the
    // UnsupportedViewer convention for the file-present case in the same card).
    const wrapper = await screen.findByTestId("deliverable-unavailable");
    expect(wrapper).toHaveClass("flex-1", "items-center", "justify-center");
  });

  it("renders the Detail panel with the DW name and human operator", async () => {
    renderContent();
    expect(
      await screen.findByRole("region", { name: "Detail" }),
    ).toBeInTheDocument();
    // `Generated by` is the authoring DW; `Operator` is the uploading human.
    expect(screen.getByText("Generated by Max")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("collapses the Detail panel and offers a restore button", async () => {
    const user = userEvent.setup();
    renderContent();
    await user.click(
      await screen.findByRole("button", { name: "Collapse panel" }),
    );
    expect(
      screen.queryByRole("region", { name: "Detail" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show panel" }),
    ).toBeInTheDocument();
  });

  it("restores the Detail panel from the collapsed state", async () => {
    const user = userEvent.setup();
    renderContent();
    await user.click(
      await screen.findByRole("button", { name: "Collapse panel" }),
    );
    await user.click(screen.getByRole("button", { name: "Show panel" }));
    expect(screen.getByRole("region", { name: "Detail" })).toBeInTheDocument();
  });

  it("deletes the deliverable from the ··· menu then navigates to the project", async () => {
    const user = userEvent.setup();
    renderContent();
    await user.click(
      await screen.findByRole("button", { name: "Asset actions" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(vi.mocked(deleteDeliverable)).toHaveBeenCalledWith(
      expect.anything(),
      7,
    );
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/project/$projectId",
        params: { projectId: "9" },
      });
    });
  });
});
