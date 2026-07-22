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

import { Button } from "@sico/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ellipsis } from "lucide-react";

import { AssetDetailMetaPanel } from "@/features/projects/components/asset-detail-meta-panel";
import { CollapsiblePanelShell } from "@/features/projects/components/collapsible-panel-shell";

const noop = (): void => {};

const meta = {
  title: "Projects/CollapsiblePanelShell",
  component: CollapsiblePanelShell,
  // Full-height stage so the bordered `h-full` column renders its left border
  // and the header sits at the top, mirroring the live page layout.
  decorators: [
    (Story): React.JSX.Element => (
      <div className="flex h-96">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Detail",
    onCollapse: noop,
    children: (
      <AssetDetailMetaPanel
        fileName="Q4 Market Research.pdf"
        createdAt={Date.UTC(2026, 0, 18, 16, 31)}
        dwName="Max"
        operator="Sarah Bennet"
      />
    ),
  },
} satisfies Meta<typeof CollapsiblePanelShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shell wrapping the simple meta-panel body — header title + collapse
 *  button over the scrolling content, as the deliverable/experience pages use. */
export const WithMetaBody: Story = {};

/** An `actions` node sits left of the collapse button — the knowledge page
 *  passes its `…` overflow menu here (shown as a static trigger). */
export const WithActions: Story = {
  args: {
    actions: (
      <Button variant="subtle" size="icon-sm" aria-label="Asset actions">
        <Ellipsis />
      </Button>
    ),
  },
};
