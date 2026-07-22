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
