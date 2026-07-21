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
