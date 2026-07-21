import type { Meta, StoryObj } from "@storybook/react-vite";

import { Input } from "../src/components/ui/input";
import { Label } from "../src/components/ui/label";

const meta = {
  title: "Components/Label",
  component: Label,
  args: {
    children: "Email address",
    htmlFor: "email",
  },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Plain label. Always pair with `htmlFor` pointing at the input's `id` for
 * accessibility — clicking the label focuses the input and screen readers
 * announce them as one control.
 */
export const Default: Story = {};

/**
 * Demonstrates the implicit dim behavior: a sibling `<input disabled>` with
 * the `peer` class makes `peer-disabled:opacity-50` on the label kick in —
 * no Context, no prop wiring. The input MUST precede the label in the DOM —
 * Tailwind's `peer-*` only matches a *previous* sibling.
 */
export const PairedWithPeerInput: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Input
        id="email"
        type="email"
        placeholder="you@example.com"
        className="peer"
      />
      <Label {...args} />
      <p className="text-foreground-tertiary text-xs">
        Disable the input below to watch the label dim via{" "}
        <code>peer-disabled:opacity-50</code>.
      </p>
      <Input
        id="email-disabled"
        type="email"
        placeholder="disabled — label dims"
        disabled
        className="peer"
      />
      <Label htmlFor="email-disabled">Email address (disabled)</Label>
    </div>
  ),
};
