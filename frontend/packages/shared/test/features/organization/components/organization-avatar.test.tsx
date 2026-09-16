import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationAvatar } from "@/features/organization/components/organization-avatar";

function loadedImage(): HTMLImageElement {
  const image = document.createElement("img");
  Object.defineProperty(image, "src", {
    get: () => image.getAttribute("src") ?? "",
    set: (src: string) => {
      image.setAttribute("src", src);
      Object.defineProperty(image, "complete", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(image, "naturalWidth", {
        configurable: true,
        value: 1,
      });
      queueMicrotask(() => image.dispatchEvent(new Event("load")));
    },
  });
  return image;
}

beforeEach(() => {
  vi.spyOn(window, "Image").mockImplementation(loadedImage);
});

afterEach(() => vi.restoreAllMocks());

describe("OrganizationAvatar", () => {
  it("renders a loaded safe icon URL", async () => {
    render(
      <OrganizationAvatar
        name="SICO"
        iconUrl="https://assets.example.test/organizations/9/avatar.png"
      />,
    );

    expect(
      await screen.findByTestId("organization-avatar-image"),
    ).toHaveAttribute(
      "src",
      "https://assets.example.test/organizations/9/avatar.png",
    );
  });

  it("falls back to the organization initial for an unsafe icon URL", () => {
    // eslint-disable-next-line no-script-url -- hostile API fixture must exercise the URL guard.
    render(<OrganizationAvatar name="SICO" iconUrl="javascript:alert(1)" />);

    expect(
      screen.queryByTestId("organization-avatar-image"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("organization-avatar")).toHaveTextContent("S");
  });
});
