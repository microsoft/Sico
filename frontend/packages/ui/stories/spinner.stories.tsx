import type { Meta, StoryObj } from "@storybook/react-vite";

import { Spinner } from "../src/components/ui/spinner";

/**
 * Loading indicator — the legacy four-dot comet animation, ported 1:1 via
 * Lottie from the old repo's `loading.json` and recolored to the SICO
 * `primary` scale. Two locked sizes: `default` (40px) for inline / route-level
 * loading, `lg` (64px) for full-page fallbacks.
 */
const meta = {
  title: "Components/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default appearance — locked 40px, `aria-label="Loading"`. Drives the
 * Controls panel.
 */
export const Default: Story = {};

/**
 * `size="lg"` — locked 64px, for full-page loading fallbacks where the
 * default 40px reads as too small against the viewport.
 */
export const Large: Story = {
  args: { size: "lg" },
};

/**
 * Overriding `aria-label` for context-specific status text — e.g. the
 * "Loading more" label on infinite-scroll footers. Size stays locked.
 */
export const CustomLabel: Story = {
  args: { "aria-label": "Loading more" },
};
