import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import type { MessageAttachment } from "@/features/chat/atoms/chat-atom";
import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { FileAttachment } from "@/features/chat/components/message/file-attachment";

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  }

  return Wrapper;
}

function makeFile(
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment {
  return {
    name: "report.pdf",
    size: 2048,
    type: "application/pdf",
    uri: "blob/report.pdf",
    sasUrl: "https://cdn.example.com/report.pdf?sig=xyz",
    id: "att-1",
    ...overrides,
  };
}

describe("FileAttachment", () => {
  it("opens the file in the sidepane when the tile is clicked", async () => {
    const store = createStore();
    const attachment = makeFile();
    const user = userEvent.setup();
    render(<FileAttachment attachment={attachment} />, {
      wrapper: withStore(store),
    });
    await user.click(screen.getByRole("button", { name: /report\.pdf/ }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "file",
      filename: "report.pdf",
      fileUrl: "https://cdn.example.com/report.pdf?sig=xyz",
    });
  });

  it("is not interactive when the attachment has no sasUrl", () => {
    const store = createStore();
    const attachment = makeFile({ sasUrl: undefined });
    render(<FileAttachment attachment={attachment} />, {
      wrapper: withStore(store),
    });
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
