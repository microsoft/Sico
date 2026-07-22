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
import { MarkdownPreviewer } from "@/features/chat/components/sidepane/previewers/markdown-previewer";

type MarkdownContent = Extract<SidepaneContent, { kind: "markdown" }>;

// A rich doc exercising the body's heading scale, prose, and a GFM table —
// the same surfaces the Figma "Sidepane Content" frame (17810:83390) shows.
const RICH_MARKDOWN = `# Target Audience Research

Digital Workers land hardest where work is repetitive, cognition can be
automated, and labour cost pressure is high.

## Core audience traits

- **Smart manufacturing** — scheduling and approval flows with heavy repetition.
- **Professional services** — finance and consulting teams drowning in documents.

## Funding by AI sub-sector

| # | Sub-sector    | Representative companies | Amount (USD M) |
| - | ------------- | ------------------------ | -------------- |
| 1 | Generative AI | Cohere                   | 240            |
| 2 | Multimodal AI | Gemini 3 Flash, GPT-5.2  | -              |
`;

// `MarkdownPreviewer` mounts `SidepaneHeader`, which reads `useSidepane()`, so
// every story needs a jotai store — a fresh one keeps the singleton atoms clean.
function renderPreviewer(content: MarkdownContent): ReactElement {
  return (
    <Provider store={createStore()}>
      {/* A panel-width surface so the header actions hug the right edge and the
          body's generous horizontal padding reads as in the live previewer. */}
      <div className="bg-surface-basic h-150 w-180">
        <MarkdownPreviewer content={content} />
      </div>
    </Provider>
  );
}

const meta: Meta<typeof MarkdownPreviewer> = {
  title: "Chat/MarkdownPreviewer",
  component: MarkdownPreviewer,
};

export default meta;
type Story = StoryObj<typeof MarkdownPreviewer>;

/** Resting state — header (with the Download action) + a rich markdown body:
 *  headings, prose, and a data table, matching the Figma content frame. */
export const Default: Story = {
  render: () =>
    renderPreviewer({
      kind: "markdown",
      title: "AI Platform Output Format Research",
      markdown: RICH_MARKDOWN,
    }),
};

/** Blank markdown (MI17) — the body swaps to the shared empty state instead of
 *  rendering an empty `Markdown`. */
export const Empty: Story = {
  render: () =>
    renderPreviewer({
      kind: "markdown",
      title: "Untitled",
      markdown: "",
    }),
};
