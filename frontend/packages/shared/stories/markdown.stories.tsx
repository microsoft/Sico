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
import type { ReactElement } from "react";

import { Markdown } from "@/components/markdown";

// A rich knowledge-document body exercising the token-styled overrides at
// once: headings, paragraph, emphasis, GFM table, links, inline code, list,
// and a divider. Authored as a joined array so the literal stays readable.
const RICH_DOCUMENT = [
  "# Knowledge Document",
  "",
  "A short **lead paragraph** with a [reference link](https://example.com)",
  "and some `inline code` woven through the prose.",
  "",
  "## Capabilities",
  "",
  "- Reads source documents",
  "- Extracts *structured* facts",
  "- Writes an experience playbook",
  "",
  "### Coverage",
  "",
  "| Region | Status |",
  "| --- | --- |",
  "| EMEA | Live |",
  "| APAC | Pilot |",
  "",
  "---",
  "",
  "#### Notes",
  "",
  "See the [runbook](https://example.com/runbook) for escalation steps.",
].join("\n");

const FENCED_CODE = [
  "Install dependencies and start the dev server:",
  "",
  "```bash",
  "pnpm install",
  "pnpm dev",
  "```",
].join("\n");

// A wider multi-row GFM table on its own, isolating the Boxed renderer: rounded
// card, filled header band, divider row separators.
const TABLE = [
  "| Region | Status | Owner | Notes |",
  "| --- | --- | --- | --- |",
  "| EMEA | Live | Ada | Stable |",
  "| APAC | Pilot | Lin | Rolling out |",
  "| AMER | Planned | Sam | Q3 kickoff |",
].join("\n");

const meta = {
  title: "Components/Markdown",
  component: Markdown,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  // Single common arg — `content`. Stories override only the diff. Wrapped in
  // a measured column so prose, tables, and code wrap as they would in the
  // asset-detail panel rather than the full canvas width.
  decorators: [
    (Story): ReactElement => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    content: RICH_DOCUMENT,
  },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A full knowledge-document body — headings, paragraph with a link and inline
 * code, a bulleted list, a GFM table, and a divider — rendering every
 * token-styled element override in one pass.
 */
export const RichDocument: Story = {};

/**
 * A fenced code block rendered through the rich CodeBox: a collapsible card
 * (default open) with a language label, syntax highlighting, and a copy button
 * that writes the code to the clipboard and fires a success toast.
 */
export const FencedCodeWithCopy: Story = {
  args: { content: FENCED_CODE },
};

/**
 * A standalone GFM table rendered as the Boxed variant — rounded `divider` card,
 * `surface-strong` header band, and `divider` row separators (no per-cell grid).
 */
export const GfmTable: Story = {
  args: { content: TABLE },
};
