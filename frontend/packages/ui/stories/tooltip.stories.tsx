import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../src/components/ui/tooltip";

type StoryArgs = {
  content: string;
  side: "top" | "right" | "bottom" | "left";
  showArrow: boolean;
};

const triggerCn =
  "border-input-stroke-rest bg-surface-basic text-foreground-primary hover:border-input-stroke-hover rounded-md border px-3 py-1.5 text-sm transition-colors";

// Tooltip is a composed primitive with no single `component`, so the meta is
// typed with `Meta<StoryArgs>` directly (CSF 3.0 composed-story form).
const meta: Meta<StoryArgs> = {
  title: "Components/Tooltip",
  parameters: { layout: "padded" },
  render: (args) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className={triggerCn}>Hover me</TooltipTrigger>
        <TooltipContent side={args.side} showArrow={args.showArrow}>
          {args.content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
  args: {
    content: "Saved to library",
    side: "top",
    showArrow: true,
  },
};

export default meta;
type Story = StoryObj<StoryArgs>;

/**
 * Default placement (`top`) with arrow. Hover the trigger to reveal.
 */
export const Default: Story = {};

/**
 * Long copy wraps to multiple lines, constrained by `max-w-xs` and balanced
 * via `text-balance`.
 */
export const LongContent: Story = {
  args: {
    content:
      "This tooltip wraps across multiple lines to demonstrate the max-width constraint and text-balance behaviour.",
  },
};

/**
 * Anchored to the right of the trigger. Side is positional, not visual.
 */
export const SideRight: Story = {
  args: { side: "right", content: "Opens to the right" },
};

/**
 * Anchored below the trigger. Useful when there isn't space above.
 */
export const SideBottom: Story = {
  args: { side: "bottom", content: "Opens below" },
};

/**
 * `showArrow={false}` removes the pointer — quieter treatment for dense UIs.
 */
export const NoArrow: Story = {
  args: { showArrow: false },
};
