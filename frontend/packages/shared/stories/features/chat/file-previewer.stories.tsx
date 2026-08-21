import type { Meta, StoryObj } from "@storybook/react-vite";
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";

import type { SidepaneContent } from "@/features/chat/atoms/sidepane-atom";
import { FilePreviewer } from "@/features/chat/components/sidepane/previewers/file-previewer";

type FileContent = Extract<SidepaneContent, { kind: "file" }>;

// A small public sample per subtype — the previewer dispatches purely on the
// url's extension, so these double as the dispatch fixtures.
const IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/3/3a/Cat03.jpg";
const VIDEO_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

// `FilePreviewer` mounts `SidepaneHeader`, which reads `useSidepane()`, so every
// story needs a jotai store — a fresh one keeps the singleton atoms clean.
function renderPreviewer(content: FileContent): ReactElement {
  return (
    <Provider store={createStore()}>
      {/* A panel-width surface so the header actions hug the right edge and the
          body fills the way the live previewer does. */}
      <div className="bg-surface-basic h-150 w-180">
        <FilePreviewer content={content} />
      </div>
    </Provider>
  );
}

const meta: Meta<typeof FilePreviewer> = {
  title: "Chat/FilePreviewer",
  component: FilePreviewer,
};

export default meta;
type Story = StoryObj<typeof FilePreviewer>;

/** Image subtype — the file is rendered inline, centered and scaled to fit. */
export const Image: Story = {
  render: () =>
    renderPreviewer({ kind: "file", filename: "cat.jpg", fileUrl: IMAGE_URL }),
};

/** Video subtype — a native `<video controls>`; a spinner overlays it until the
 *  browser can play (MI16). */
export const Video: Story = {
  render: () =>
    renderPreviewer({
      kind: "file",
      filename: "flower.mp4",
      fileUrl: VIDEO_URL,
    }),
};

/** Staged subtype (office/pdf/markdown/html/glb) — a labeled placeholder until
 *  the real viewer lands in tasks 59/60/61. */
export const Placeholder: Story = {
  render: () =>
    renderPreviewer({
      kind: "file",
      filename: "deck.pptx",
      fileUrl: "https://example.com/files/deck.pptx",
    }),
};

/** Unknown subtype — preview isn't supported, so the body offers a Download
 *  call-to-action (the header keeps its own Download too). */
export const Unsupported: Story = {
  render: () =>
    renderPreviewer({
      kind: "file",
      filename: "data.csv",
      fileUrl: "https://example.com/files/data.csv",
    }),
};
