import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DwAvatar } from "@/components/dw-avatar";

// Test the composer's URL boundary without Base UI's off-DOM image loader.
vi.mock("@sico/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sico/ui")>();
  return {
    ...actual,
    AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (
      <img src={src} alt={alt} data-testid="avatar-image" />
    ),
  };
});

describe("<DwAvatar>", () => {
  const agent = { iconUri: "https://example.test/a.png" };
  const label = "Atlas Agent";

  it("renders <AvatarImage> when iconUri is provided", () => {
    render(<DwAvatar agent={agent} label={label} />);
    const imgs = screen.getAllByAltText(label);
    expect(imgs.length).toBeGreaterThan(0);
  });

  it("renders only the default DW fallback when iconUri is missing", () => {
    render(<DwAvatar agent={{}} label={label} />);
    const imgs = screen.getAllByAltText(label);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute("src")).toBeTruthy();
  });

  it("prefers a trusted local preview over the persisted avatar", () => {
    render(
      <DwAvatar agent={agent} previewSrc="blob:local-avatar" label={label} />,
    );

    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      "blob:local-avatar",
    );
  });

  it("updates the preview when the selected image changes", () => {
    const { rerender } = render(
      <DwAvatar agent={agent} previewSrc="blob:first" label={label} />,
    );
    rerender(<DwAvatar agent={agent} previewSrc="blob:second" label={label} />);

    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      "blob:second",
    );
  });

  it("rejects a blob URL supplied as a persisted iconUri", () => {
    render(<DwAvatar agent={{ iconUri: "blob:untrusted" }} label={label} />);

    expect(screen.queryByTestId("avatar-image")).not.toBeInTheDocument();
  });

  it("returns to the persisted avatar when the preview is cleared", () => {
    const { rerender } = render(
      <DwAvatar agent={agent} previewSrc="blob:local" label={label} />,
    );
    rerender(<DwAvatar agent={agent} label={label} />);

    expect(screen.getByTestId("avatar-image")).toHaveAttribute(
      "src",
      agent.iconUri,
    );
  });

  it("sets empty alt when decorative", () => {
    render(<DwAvatar agent={agent} decorative />);
    expect(screen.queryByAltText(label)).toBeNull();
  });

  it("forwards size to Avatar via data-size", () => {
    render(<DwAvatar agent={agent} label={label} size="xs" />);
    const root = screen.getByTestId("avatar-root");
    expect(root.getAttribute("data-size")).toBe("xs");
  });

  it("defaults size to 'default'", () => {
    render(<DwAvatar agent={agent} label={label} />);
    const root = screen.getByTestId("avatar-root");
    expect(root.getAttribute("data-size")).toBe("default");
  });
});
