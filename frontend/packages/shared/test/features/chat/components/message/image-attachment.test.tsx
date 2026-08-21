import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider as JotaiProvider } from "jotai";
import { type PropsWithChildren, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import type { MessageAttachment } from "@/features/chat/atoms/chat-atom";
import { sidepaneContentAtom } from "@/features/chat/atoms/sidepane-atom";
import { ImageAttachment } from "@/features/chat/components/message/image-attachment";

function withStore(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  function Wrapper({ children }: PropsWithChildren): ReactElement {
    return <JotaiProvider store={store}>{children}</JotaiProvider>;
  }

  return Wrapper;
}

function makeImage(
  overrides: Partial<MessageAttachment> = {},
): MessageAttachment {
  return {
    name: "diagram.png",
    size: 1024,
    type: "image/png",
    uri: "blob/diagram.png",
    sasUrl: "https://cdn.example.com/diagram.png?sig=abc",
    id: "att-1",
    ...overrides,
  };
}

describe("ImageAttachment", () => {
  it("opens the image as file content in the sidepane when clicked", async () => {
    const store = createStore();
    const attachment = makeImage();
    const user = userEvent.setup();
    render(<ImageAttachment attachment={attachment} />, {
      wrapper: withStore(store),
    });
    await user.click(screen.getByRole("button", { name: "diagram.png" }));
    expect(store.get(sidepaneContentAtom)).toEqual({
      kind: "file",
      filename: "diagram.png",
      fileUrl: "https://cdn.example.com/diagram.png?sig=abc",
    });
  });

  it("is not interactive when the attachment has no sasUrl", () => {
    const store = createStore();
    const attachment = makeImage({ sasUrl: undefined });
    render(<ImageAttachment attachment={attachment} />, {
      wrapper: withStore(store),
    });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
