import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type Attachment } from "@/features/chat/atoms/chat-atom";
import { AttachmentBar } from "@/features/chat/components/attachment-bar";

function ready(localId: string, name: string): Attachment {
  return { localId, file: new File(["x"], name), status: "ready" };
}

describe("AttachmentBar", () => {
  it("renders one chip per attachment", () => {
    render(
      <AttachmentBar
        attachments={[ready("a", "one.pdf"), ready("b", "two.pdf")]}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("one.pdf")).toBeInTheDocument();
    expect(screen.getByText("two.pdf")).toBeInTheDocument();
  });

  it("renders nothing when empty", () => {
    const { container } = render(
      <AttachmentBar attachments={[]} onRemove={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
