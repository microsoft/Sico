import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetDetailPage } from "@/features/projects/components/asset-detail-page";

// Drive the suspending body into pending / error without a real query — its own
// behavior is covered by asset-detail-content tests. This suite only asserts the
// two jobs AssetDetailPage owns: the type→skeleton-variant mapping and the error
// fallback.
const { contentImpl } = vi.hoisted(() => ({
  contentImpl: vi.fn((): ReactNode => null),
}));
vi.mock("@/features/projects/components/asset-detail-content", () => ({
  AssetDetailContent: (): ReactNode => contentImpl(),
}));

// Surface the `variant` the page passes as a queryable attribute, so the
// assertion targets AssetDetailPage's derivation, not the skeleton's DOM shape.
vi.mock("@/features/projects/components/asset-detail-skeleton", () => ({
  AssetDetailSkeleton: ({ variant }: { variant?: string }): ReactElement => (
    <div data-testid="skeleton" data-variant={variant} />
  ),
}));

// A promise that never settles keeps the component suspended, so the Suspense
// fallback stays mounted for the assertion.
function suspend(): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense unwraps thrown Promises to render the fallback.
  throw new Promise(() => {});
}

function renderPage(
  type: "knowledge" | "experience" | "deliverable",
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetDetailPage assetId={1} type={type} projectId={2} />
    </QueryClientProvider>,
  );
}

describe("<AssetDetailPage>", () => {
  beforeEach(() => {
    contentImpl.mockReset();
  });

  it("shows the rich skeleton while a knowledge asset loads", () => {
    contentImpl.mockImplementation(suspend);
    renderPage("knowledge");
    expect(screen.getByTestId("skeleton")).toHaveAttribute(
      "data-variant",
      "rich",
    );
  });

  it("shows the simple skeleton while a deliverable asset loads", () => {
    contentImpl.mockImplementation(suspend);
    renderPage("deliverable");
    expect(screen.getByTestId("skeleton")).toHaveAttribute(
      "data-variant",
      "simple",
    );
  });

  it("shows the simple skeleton while an experience asset loads", () => {
    contentImpl.mockImplementation(suspend);
    renderPage("experience");
    expect(screen.getByTestId("skeleton")).toHaveAttribute(
      "data-variant",
      "simple",
    );
  });

  it("renders the error fallback when the detail body throws", () => {
    // ErrorView + React both log the caught error to console.error; silence it.
    vi.spyOn(console, "error").mockImplementation(() => {});
    contentImpl.mockImplementation(() => {
      throw new Error("detail load failed");
    });
    renderPage("knowledge");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
