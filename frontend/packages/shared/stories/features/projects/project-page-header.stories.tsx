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

import { ProjectPageHeader } from "@/features/projects/components/project-page-header";

const noop = (): void => {};

const meta = {
  title: "Projects/ProjectPageHeader",
  component: ProjectPageHeader,
  // Canvas-tinted stage so the bar's transparent fill reads as it does in the
  // live page; fixed width so the breadcrumb leaf has room to truncate.
  decorators: [
    (Story): React.JSX.Element => (
      <div className="bg-surface-canvas w-160">
        <Story />
      </div>
    ),
  ],
  args: {
    label: "Project",
    onBack: noop,
  },
} satisfies Meta<typeof ProjectPageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** List / tag pages: the `label` segment alone (clickable, routes up one
 *  level). No `current`, so no breadcrumb trail. */
export const SingleSegment: Story = {};

/** Asset-detail pages: `label / current` — `label` muted+clickable, `current`
 *  the open asset's name in primary text. */
export const Breadcrumb: Story = {
  args: {
    current: "Beijing Weather Report.pdf",
  },
};

/** A long leaf truncates to one line rather than pushing the bar wider. */
export const LongLeafTruncates: Story = {
  args: {
    current:
      "Q4 2026 Regional Market Research — Greater China, Full Methodology Appendix.pdf",
  },
};
