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
