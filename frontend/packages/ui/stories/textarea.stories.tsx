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

import { Textarea } from "../src/components/ui/textarea";

/**
 * Bare native textarea with `field-sizing-content` auto-grow. For char-count
 * footers or surrounding labels, compose with `<InputGroup>` (via
 * `<InputGroupTextarea>`) and `<Field>` — see those stories.
 */
const meta = {
  title: "Components/Textarea",
  component: Textarea,
  args: {
    placeholder: "Tell us a bit about yourself…",
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Empty state. Single-line height by default; grows as the user types
 * thanks to `field-sizing-content`.
 */
export const Default: Story = {};

/**
 * Filled with `defaultValue`. Try editing — the height adapts to the
 * content automatically.
 */
export const WithValue: Story = {
  args: {
    defaultValue:
      "I'm a designer who loves building component libraries. Try editing this — the textarea auto-grows.",
  },
};

/**
 * Disabled state. Pointer events blocked, contrast reduced.
 */
export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Can't edit this" },
};

/**
 * Validation failure. `aria-invalid="true"` switches the fill to
 * `input-fill-error` and the border to `input-stroke-error`. No focus ring.
 */
export const Invalid: Story = {
  args: { "aria-invalid": "true", defaultValue: "Too short" },
};

/**
 * Setting `rows` together with `min-h-` opts out of auto-grow and gives you
 * a fixed-height textarea that the user can drag-resize.
 */
export const FixedRows: Story = {
  args: { rows: 6, className: "min-h-32 resize-y" },
};
