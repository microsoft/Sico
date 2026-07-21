import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkbox } from "../src/components/ui/checkbox";

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
  args: {
    defaultChecked: false,
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default appearance — unchecked and interactive. Toggle `defaultChecked`
 * in the Controls panel; everything else only overrides the diff.
 */
export const Default: Story = {};

/**
 * Checked state. The box fills via the `data-checked:` CSS state selectors —
 * no JS prop drives the fill, so it works in both controlled and uncontrolled
 * mode.
 */
export const Checked: Story = {
  args: { defaultChecked: true },
};

/**
 * Non-interactive state. Disabled styling comes from the `disabled:` utilities
 * (dimmed, no pointer events).
 */
export const Disabled: Story = {
  args: { disabled: true },
};

/**
 * Error state. `aria-invalid` paints the destructive border + ring for form
 * validation feedback.
 */
export const Invalid: Story = {
  args: { "aria-invalid": true },
};
