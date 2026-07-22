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

import { Card } from "@/components/card";

const meta = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
  argTypes: {
    // `children` is `ReactNode` — Storybook can't infer a control for it.
    children: { control: "text" },
  },
  args: {
    children: "Card content",
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default surface — renders a `<div>` carrying the shared card styling
 *  (background, border, hover/active/focus states, radius, padding). */
export const Default: Story = {};

/** Per-card layout is appended after the surface via `className`; here a
 *  fixed height plus a top/bottom split, the way the Digital Worker card
 *  shapes the same surface. */
export const WithLayout: Story = {
  args: {
    className: "h-32 items-start justify-between",
    children: (
      <>
        <span className="text-foreground-primary font-semibold">Chloe</span>
        <span className="text-foreground-tertiary text-sm">Marketing</span>
      </>
    ),
  },
};

/** `asChild` merges the surface onto its single child instead of a wrapping
 *  `<div>`, so the card itself is the interactive element — here a
 *  `<button>` that carries the surface classes and a disabled treatment. */
export const AsButton: Story = {
  args: {
    asChild: true,
    className:
      "cursor-pointer disabled:pointer-events-none disabled:opacity-50",
    children: <button type="button">Click the whole card</button>,
  },
};
