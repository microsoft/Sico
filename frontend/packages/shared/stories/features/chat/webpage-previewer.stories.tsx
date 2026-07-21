import type { Meta, StoryObj } from "@storybook/react-vite";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { WebpagePreviewer } from "@/features/chat/components/sidepane/previewers/webpage-previewer";

type WebpageContent = Extract<SidepaneContent, { kind: "webpage" }>;

// `WebpagePreviewer` mounts `SidepaneHeader`, which reads `useSidepane()`, so
// every story needs a jotai store — a fresh one keeps the singleton atoms clean.
function renderPreviewer(content: WebpageContent): ReactElement {
  return (
    <Provider store={createStore()}>
      {/* A panel-width surface so the header actions hug the right edge and the
          full-bleed frame fills the body the way the live previewer does. */}
      <div className="bg-surface-basic h-150 w-180">
        <WebpagePreviewer content={content} />
      </div>
    </Provider>
  );
}

const meta: Meta<typeof WebpagePreviewer> = {
  title: "Chat/WebpagePreviewer",
  component: WebpagePreviewer,
};

export default meta;
type Story = StoryObj<typeof WebpagePreviewer>;

/** Loading state (MI16) — a valid https URL mounts the sandboxed frame; until
 *  it fires `load` the spinner overlays the body. (Storybook's frame may stay
 *  blank behind the overlay, which is the point: the spinner is what shows.) */
export const Loading: Story = {
  render: () =>
    renderPreviewer({ kind: "webpage", url: "https://example.com" }),
};

/** Blocked state (MI5) — a `javascript:` URL fails the https guard, so no frame
 *  is ever mounted; the previewer shows the shared blocked message instead. */
export const Blocked: Story = {
  render: () =>
    // Join the parts so the security fixture stays without writing a literal
    // `javascript:` URL (which trips eslint's `no-script-url`) — same idiom as
    // the safeWebpageUrl guard test.
    renderPreviewer({
      kind: "webpage",
      url: ["javascript", "alert(1)"].join(":"),
    }),
};
