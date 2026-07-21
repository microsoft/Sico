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
