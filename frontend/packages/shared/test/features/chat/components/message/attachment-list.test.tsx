import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MessageAttachment } from "@/features/chat/atoms/chat-atom";
import { AttachmentList } from "@/features/chat/components/message/attachment-list";

const imageAttachment: MessageAttachment = {
  name: "diagram.png",
  size: 1024,
  type: "image/png",
  uri: "blob/diagram.png",
  sasUrl: "https://cdn.example.com/diagram.png?sig=abc",
  id: "att-1",
};

const fileAttachment: MessageAttachment = {
  name: "Performance test suite test case.pdf",
  size: 2048,
  type: "application/pdf",
  uri: "blob/perf.pdf",
  sasUrl: "https://cdn.example.com/perf.pdf?sig=xyz",
  id: "att-2",
};

describe("AttachmentList", () => {
  it("renders an image attachment as a thumbnail sourced from its sasUrl", () => {
    const { container } = render(
      <AttachmentList attachments={[imageAttachment]} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", imageAttachment.sasUrl);
    expect(img).toHaveAttribute("alt", imageAttachment.name);
  });

  it("renders a non-image attachment as a file card showing its filename", () => {
    const { container } = render(
      <AttachmentList attachments={[fileAttachment]} />,
    );
    expect(screen.getByText(fileAttachment.name)).toBeInTheDocument();
    // A file card has no <img> — its glyph is a lucide icon, not a thumbnail.
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a mixed list — image thumbnail and file card together", () => {
    const { container } = render(
      <AttachmentList attachments={[imageAttachment, fileAttachment]} />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      imageAttachment.sasUrl,
    );
    expect(screen.getByText(fileAttachment.name)).toBeInTheDocument();
  });

  it("is read-only — renders no remove control (≠ the pre-send chip)", () => {
    render(<AttachmentList attachments={[imageAttachment, fileAttachment]} />);
    // The sent strip has no remove pill (that's the editable composer chip).
    // The tiles are still activatable buttons — they open the sidepane preview.
    expect(
      screen.queryByLabelText("Remove attachment"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove image")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove file")).not.toBeInTheDocument();
  });

  it("renders the borderless object-cover thumbnail for images", () => {
    const { container } = render(
      <AttachmentList attachments={[imageAttachment]} />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveClass("h-full", "w-full", "object-cover");
    expect(img?.className).not.toMatch(/\bborder\b/);
  });

  it("uses token classes only — no hardcoded hex", () => {
    const { container } = render(
      <AttachmentList attachments={[imageAttachment, fileAttachment]} />,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
