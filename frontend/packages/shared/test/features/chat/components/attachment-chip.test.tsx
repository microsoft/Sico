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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Attachment } from "@/features/chat/atoms/chat-atom";
import { AttachmentChip } from "@/features/chat/components/attachment-chip";

// One test overrides the unique-blob mock; restore the shared "blob:mock"
// stub so the static-markup tests that assert src="blob:mock" stay green.
afterEach(() => {
  vi.mocked(URL.createObjectURL).mockReturnValue("blob:mock");
  vi.mocked(URL.revokeObjectURL).mockReset();
});

function fileAttachment(over: Partial<Attachment> = {}): Attachment {
  return {
    localId: "a1",
    file: new File(["x"], "report.pdf", { type: "application/pdf" }),
    status: "ready",
    ...over,
  };
}

describe("AttachmentChip", () => {
  it("shows the filename for a ready file chip", () => {
    render(<AttachmentChip attachment={fileAttachment()} onRemove={vi.fn()} />);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("shows a spinner while uploading", () => {
    render(
      <AttachmentChip
        attachment={fileAttachment({ status: "uploading" })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId("file-tile-loading")).toBeInTheDocument();
  });

  it("fires onRemove with the localId when × is clicked", async () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChip attachment={fileAttachment()} onRemove={onRemove} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove attachment" }),
    );
    expect(onRemove).toHaveBeenCalledWith("a1");
  });

  it("overlays the remove button on an image chip", () => {
    render(
      <AttachmentChip
        attachment={fileAttachment({
          file: new File(["x"], "pic.png", { type: "image/png" }),
        })}
        onRemove={vi.fn()}
      />,
    );
    const remove = screen.getByRole("button", { name: "Remove attachment" });
    expect(remove).toHaveClass("absolute", "top-1", "right-1", "rounded-sm");
    expect(remove).not.toHaveClass("self-start");
  });

  it("renders an <img> thumbnail for image attachments", () => {
    render(
      <AttachmentChip
        attachment={fileAttachment({
          file: new File(["x"], "pic.png", { type: "image/png" }),
        })}
        onRemove={vi.fn()}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "blob:mock");
    expect(img).toHaveAttribute("alt", "pic.png");
  });

  it("revokes the object URL on unmount (no blob leak)", () => {
    const { unmount } = render(
      <AttachmentChip
        attachment={fileAttachment({
          file: new File(["x"], "pic.png", { type: "image/png" }),
        })}
        onRemove={vi.fn()}
      />,
    );
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  // StrictMode (dev) mounts → unmounts → remounts: the URL the live <img>
  // points at must NOT be one that was revoked, or the thumbnail is broken.
  // Unique-blob tracking catches the split create/revoke bug the shared
  // "blob:mock" mock cannot.
  it("renders a live (non-revoked) object URL under StrictMode", async () => {
    let n = 0;
    const revoked = new Set<string>();
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      n += 1;
      return `blob:${n}`;
    });
    vi.mocked(URL.revokeObjectURL).mockImplementation((u) =>
      revoked.add(String(u)),
    );
    render(
      <StrictMode>
        <AttachmentChip
          attachment={fileAttachment({
            file: new File(["x"], "pic.png", { type: "image/png" }),
          })}
          onRemove={vi.fn()}
        />
      </StrictMode>,
    );
    const src = (await screen.findByRole("img")).getAttribute("src") ?? "";
    expect(revoked.has(src)).toBe(false);
  });

  // First-paint (no-effects) render: createObjectURL is synchronous, so the
  // <img> must be present on the very first frame — no `previewUrl === null`
  // placeholder box. `renderToStaticMarkup` renders WITHOUT running effects, so
  // it captures exactly that first frame. The pre-fix code creates the URL in a
  // useEffect, so its first frame has no <img> (placeholder only) → this fails
  // until the URL is created during render (lazy init). Removing the null-frame
  // is what eliminates the size jump from the 144² placeholder to the image.
  it("renders the image thumbnail on the first paint (no placeholder frame)", () => {
    const html = renderToStaticMarkup(
      <AttachmentChip
        attachment={fileAttachment({
          file: new File(["x"], "pic.png", { type: "image/png" }),
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain('src="blob:mock"');
    expect(html).toContain('alt="pic.png"');
  });

  // The loading affordance is the UPLOAD overlay, driven solely by
  // `status === "uploading"` — local preview is never a loading state
  // (createObjectURL is synchronous). A ready image shows no spinner even on
  // the first paint; an uploading image shows the overlay spinner on the image.
  it("shows no spinner for a ready image, on the first paint", () => {
    const html = renderToStaticMarkup(
      <AttachmentChip
        attachment={fileAttachment({
          file: new File(["x"], "pic.png", { type: "image/png" }),
          status: "ready",
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(html).toContain('src="blob:mock"');
    expect(html).not.toContain("animate-spin");
  });

  it("overlays the upload spinner on the image while uploading", () => {
    render(
      <AttachmentChip
        attachment={fileAttachment({
          file: new File(["x"], "pic.png", { type: "image/png" }),
          status: "uploading",
        })}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId("image-tile-loading")).toBeInTheDocument();
    // The overlay sits over the rendered <img>, not in place of it.
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:mock");
  });
});
