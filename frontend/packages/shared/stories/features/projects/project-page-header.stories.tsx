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
