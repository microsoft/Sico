import { DW_DEFAULT_AVATAR_URL } from "@sico/ui";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DwAvatar } from "@/components/dw-avatar";

// Constructable browser-image mock; keep the actual Base UI state machine.
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

describe("DwAvatar preview loading", () => {
  it("restores the default after a loaded upload preview is cleared", async () => {
    const { rerender } = render(
      <DwAvatar
        agent={{ iconUri: "" }}
        previewSrc="blob:preview"
        label="Worker"
      />,
    );
    expect(await screen.findByTestId("avatar-image")).toHaveAttribute(
      "src",
      "blob:preview",
    );
    expect(
      screen.queryByTestId("avatar-fallback-image"),
    ).not.toBeInTheDocument();

    rerender(<DwAvatar agent={{ iconUri: "" }} label="Worker" />);

    expect(await screen.findByTestId("avatar-fallback-image")).toHaveAttribute(
      "src",
      DW_DEFAULT_AVATAR_URL,
    );
  });
});
