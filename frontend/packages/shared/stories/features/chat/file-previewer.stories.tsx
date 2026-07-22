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
