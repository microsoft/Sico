import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { MarkdownPreviewer } from "@/features/chat/components/sidepane/previewers/markdown-previewer";

type MarkdownContent = Extract<SidepaneContent, { kind: "markdown" }>;

// Fresh fixture per test — the sidepane atoms are module singletons, so a
// dirty object would bleed across cases.
function makeContent(
  overrides: Partial<MarkdownContent> = {},
): MarkdownContent {
  return {
    kind: "markdown",
    title: "My Report",
    markdown: "# Hello",
    ...overrides,
  };
}

// MarkdownPreviewer mounts SidepaneHeader, which reads useSidepane() — so every
// render needs a jotai store (mirrors the SidepaneHeader test setup).
function renderPreviewer(content: MarkdownContent): ReturnType<typeof render> {
  const ui: ReactElement = <MarkdownPreviewer content={content} />;
  return render(<Provider store={createStore()}>{ui}</Provider>);
}

const FAKE_URL = "blob:markdown-previewer-test";

describe("MarkdownPreviewer", () => {
  let createObjectURL: Mock;
  let revokeObjectURL: Mock;

  beforeEach(() => {
    // jsdom implements neither Object-URL method; install fresh fakes so the
    // download handler can run and we can assert the create/revoke pairing.
    createObjectURL = vi.fn(() => FAKE_URL);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    // Stop jsdom from acting on the programmatic <a download> click (it would
    // warn about unimplemented navigation).
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the title through the mounted header", () => {
    renderPreviewer(makeContent({ title: "My Report" }));
    expect(screen.getByText("My Report")).toBeInTheDocument();
  });

  it("renders the markdown body", () => {
    renderPreviewer(makeContent({ markdown: "# Hello" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("gives the body a fluid reading gutter (px-4, widening to px-34 at @3xl)", () => {
    // #260: a fixed px-34 crushes the body in a narrow side-pane. The gutter is
    // now container-query driven — px-4 by default, px-34 only once the pane is
    // wide (@3xl). jsdom can't evaluate the container query, so this pins the
    // class contract rather than the resolved padding.
    renderPreviewer(makeContent());
    const body = screen.getByTestId("markdown-previewer-body");
    expect(body).toHaveClass("px-4", "@3xl:px-34");
  });

  it("creates one object URL when Download is clicked", async () => {
    const user = userEvent.setup();
    renderPreviewer(makeContent());

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it("revokes the object URL it created in the same handler (MI9 — no leak)", async () => {
    const user = userEvent.setup();
    renderPreviewer(makeContent());

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith(FAKE_URL);
  });

  it("attaches the download anchor to the document before clicking (Firefox gap)", async () => {
    const user = userEvent.setup();
    // A programmatic click on a DETACHED <a download> doesn't trigger a download
    // in Firefox — capture whether the anchor was connected at click time.
    let connectedAtClick = false;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function captureConnected(this: HTMLAnchorElement) {
        connectedAtClick = this.isConnected;
      },
    );
    renderPreviewer(makeContent());

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(connectedAtClick).toBe(true);
  });

  it("falls back to 'Untitled.md' as the download name when the title is blank", async () => {
    const user = userEvent.setup();
    // A blank title would otherwise download a nameless ".md" dotfile.
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function captureName(this: HTMLAnchorElement) {
        downloadName = this.download;
      },
    );
    renderPreviewer(makeContent({ title: "   ", markdown: "# B" }));

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(downloadName).toBe("Untitled.md");
  });

  it("renders the empty-state copy when markdown is blank (MI17)", () => {
    renderPreviewer(makeContent({ markdown: "" }));
    expect(
      screen.getByText("There's nothing to preview here yet."),
    ).toBeInTheDocument();
  });

  it("does not render a markdown body when markdown is blank (MI17)", () => {
    renderPreviewer(makeContent({ markdown: "" }));
    expect(
      screen.queryByTestId("markdown-previewer-body"),
    ).not.toBeInTheDocument();
  });

  it("treats whitespace-only markdown as empty (MI17)", () => {
    renderPreviewer(makeContent({ markdown: "\n\n" }));
    expect(
      screen.getByText("There's nothing to preview here yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("markdown-previewer-body"),
    ).not.toBeInTheDocument();
  });
});
