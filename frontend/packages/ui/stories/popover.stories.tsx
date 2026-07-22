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

import { Button } from "../src/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../src/components/ui/popover";

function TriggerButton({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <PopoverTrigger className="border-input-stroke-rest bg-surface-basic text-foreground-secondary hover:border-input-stroke-hover rounded-md border px-3 py-1.5 text-sm transition-colors">
      {children}
    </PopoverTrigger>
  );
}

const meta = {
  title: "Components/Popover",
  component: PopoverContent,
  parameters: { layout: "padded" },
  args: {
    align: "center",
    alignOffset: 0,
    side: "bottom",
    sideOffset: 4,
  },
  decorators: [
    (Story): React.ReactElement => (
      // pb-72: leave room for the popup to open downward without
      // viewport-flipping inside the Storybook canvas.
      <div className="pb-72">
        <Story />
      </div>
    ),
  ],
  render: (args): React.ReactElement => (
    <Popover>
      <TriggerButton>Open popover</TriggerButton>
      <PopoverContent {...args}>
        <PopoverHeader>
          <PopoverTitle className="text-foreground-primary text-sm">
            Title
          </PopoverTitle>
        </PopoverHeader>
        <div className="bg-primary-200 h-16 w-full rounded-sm" />
        {/* Action row composed from plain layout utilities — no dedicated
            footer slot. */}
        <div className="flex justify-end gap-1.5 pt-2">
          <Button size="xs" variant="secondary">
            Cancel
          </Button>
          <Button size="xs" variant="primary">
            Confirm
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  ),
} satisfies Meta<typeof PopoverContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default appearance — header, content, and an end-aligned action row
 * (plain `div` + Buttons), anchored bottom-center against the trigger.
 * Use this story to drive Controls.
 */
export const Default: Story = {};

/**
 * Left-edge alignment — the popup's start edge lines up with the
 * trigger's start edge instead of centering below it.
 */
export const AlignmentStart: Story = {
  args: { align: "start" },
};

/**
 * Demonstrates `PopoverTitle` + `PopoverDescription`. Base UI wires
 * `aria-labelledby` / `aria-describedby` onto the popup automatically,
 * giving screen readers the title and description for the dialog.
 */
export const WithDescription: Story = {
  render: (args): React.ReactElement => (
    <Popover>
      <TriggerButton>Open popover</TriggerButton>
      <PopoverContent {...args}>
        <PopoverHeader>
          <PopoverTitle className="text-foreground-primary text-sm">
            Notifications
          </PopoverTitle>
          <PopoverDescription>
            Choose how you want to be notified about new comments.
          </PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
};
