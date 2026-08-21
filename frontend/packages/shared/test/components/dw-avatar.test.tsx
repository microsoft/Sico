import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DwAvatar } from "@/components/dw-avatar";

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
