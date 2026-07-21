import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Spinner } from "../../src/components/ui/spinner";

// `lottie-react` drives an SVG/rAF render loop jsdom can't run, and the loader
// is a third-party concern anyway. Mock it at the module seam: the real
// `loading.json` import still resolves — only the renderer is stubbed.
vi.mock("lottie-react", () => ({
  default: function LottieMock({
    loop,
    autoplay,
  }: {
    loop?: boolean;
    autoplay?: boolean;
  }) {
    return (
      <div
        data-testid="spinner-animation"
        data-loop={String(Boolean(loop))}
        data-autoplay={String(Boolean(autoplay))}
      />
    );
  },
}));

describe("Spinner", () => {
  it("renders with the status role and a default accessible label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("lets callers override the accessible label", () => {
    render(<Spinner aria-label="Loading more" />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Loading more",
    );
  });

  it("forwards className for layout while keeping the size locked at 40px", () => {
    render(<Spinner className="mt-4 size-4" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("mt-4");
    expect(el).toHaveClass("size-10");
    expect(el).not.toHaveClass("size-4");
  });

  it("renders the lg size variant at 64px and ignores className overrides", () => {
    render(<Spinner size="lg" className="size-4" />);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("size-16");
    expect(el).not.toHaveClass("size-10");
    expect(el).not.toHaveClass("size-4");
  });

  it("plays the loader animation on a continuous loop", () => {
    render(<Spinner />);
    const animation = screen.getByTestId("spinner-animation");
    expect(animation).toHaveAttribute("data-loop", "true");
    expect(animation).toHaveAttribute("data-autoplay", "true");
  });
});
