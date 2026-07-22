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
