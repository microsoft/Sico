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
import { ChevronDownIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";

import { Button } from "../src/components/ui/button";

const meta = {
  title: "Components/Button",
  component: Button,
  args: {
    children: "Button",
    variant: "primary",
    size: "default",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ============ Variants ============ */

/**
 * The main call-to-action. Use for the single most important action on screen.
 */
export const Primary: Story = {};

/**
 * For secondary actions that complement the primary. Has a visible border.
 */
export const Secondary: Story = {
  args: { variant: "secondary" },
};

/**
 * Low-emphasis actions. Transparent at rest, fills on hover. Use inside
 * toolbars and dense UIs.
 */
export const Subtle: Story = {
  args: { variant: "subtle" },
};

/**
 * For dangerous actions that are difficult or impossible to undo. Same shape
 * as Subtle but with red text.
 */
export const Destructive: Story = {
  args: { variant: "destructive", children: "Delete" },
};

/**
 * Secondary-style destructive button with white fill, red border, red text,
 * and shadow. For prominent dangerous actions.
 */
export const DestructiveOutline: Story = {
  args: { variant: "destructive-outline", children: "Delete" },
};

/**
 * For actions styled as inline links. Use for low-importance, navigation-like
 * actions.
 */
export const Link: Story = {
  args: { variant: "link", children: "View details" },
};

/* ============ Sizes ============ */

/**
 * 24px. Compact size for dense toolbars.
 */
export const Xs: Story = {
  args: { size: "xs" },
};

/**
 * 28px. Slightly smaller than default for tighter layouts.
 */
export const Small: Story = {
  args: { size: "sm" },
};

/**
 * 36px. Prominent CTA on landing or focus-mode screens.
 */
export const Large: Story = {
  args: { size: "lg" },
};

/* ============ Icons ============ */

/**
 * Icon placed before the label. Tag the icon element with
 * `data-icon="inline-start"` — the cva base class applies `size-4` and
 * tightens the start padding via `has-data-[icon=inline-start]:pl-*`.
 */
export const WithStartIcon: Story = {
  args: {
    children: (
      <>
        <PlusIcon data-icon="inline-start" />
        Add item
      </>
    ),
  },
};

/**
 * Icon placed after the label via `data-icon="inline-end"`. Common for
 * dropdowns and external links.
 */
export const WithEndIcon: Story = {
  args: {
    variant: "secondary",
    children: (
      <>
        Options
        <ChevronDownIcon data-icon="inline-end" />
      </>
    ),
  },
};

/**
 * Both `inline-start` and `inline-end` icons together. Icons get default
 * `size-4` via the cva base class — never size them manually.
 */
export const WithBothIcons: Story = {
  args: {
    variant: "secondary",
    children: (
      <>
        <ExternalLinkIcon data-icon="inline-start" />
        Open link
        <ChevronDownIcon data-icon="inline-end" />
      </>
    ),
  },
};

/**
 * Square icon-only button for toolbars and compact layouts. Use `size="icon"`
 * and pass the icon as `children`.
 */
export const IconOnly: Story = {
  args: { size: "icon", children: <PlusIcon /> },
};

/**
 * 24px icon-only button. Matches `xs` text-button height — pair them in dense
 * toolbars.
 */
export const IconXs: Story = {
  args: { size: "icon-xs", children: <PlusIcon /> },
};

/**
 * 28px icon-only button. Matches `sm` text-button height.
 */
export const IconSm: Story = {
  args: { size: "icon-sm", children: <PlusIcon /> },
};

/**
 * 36px icon-only button. Matches `lg` text-button height — for hero / focus
 * surfaces.
 */
export const IconLg: Story = {
  args: { size: "icon-lg", children: <PlusIcon /> },
};

/**
 * Side-by-side comparison of the glyph across every size. All sizes inherit the
 * cva base `size-4` (16px) glyph — the container shrinks per size, the icon does
 * not. Top row: icon-only buttons. Bottom row: text buttons with a start icon,
 * so `xs` / `sm` glyphs read at the same 16px as the rest.
 */
export const IconSizeComparison: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button size="icon-xs">
          <PlusIcon />
        </Button>
        <Button size="icon-sm">
          <PlusIcon />
        </Button>
        <Button size="icon">
          <PlusIcon />
        </Button>
        <Button size="icon-lg">
          <PlusIcon />
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button size="xs">
          <PlusIcon data-icon="inline-start" />
          xs
        </Button>
        <Button size="sm">
          <PlusIcon data-icon="inline-start" />
          sm
        </Button>
        <Button size="default">
          <PlusIcon data-icon="inline-start" />
          default
        </Button>
        <Button size="lg">
          <PlusIcon data-icon="inline-start" />
          lg
        </Button>
      </div>
    </div>
  ),
};

/* ============ States ============ */

/**
 * Disabled state. Pointer events are blocked, contrast is reduced, shadow is
 * removed. Behaviour is defined per-variant inside the cva config.
 */
export const Disabled: Story = {
  args: { disabled: true },
};

/**
 * Invalid state via `aria-invalid="true"`. Applies a destructive border and
 * 3px destructive ring at 20% opacity — surfaces form-validation errors.
 */
export const Invalid: Story = {
  args: { "aria-invalid": true },
};

/**
 * Expanded state via `aria-expanded="true"`. Use when the button toggles a
 * popover/menu/disclosure so assistive tech can announce open state. The press
 * affordance (`active:translate-y-px`) is intentionally suppressed for
 * `aria-haspopup` triggers — see Upstream Audit.
 */
export const Expanded: Story = {
  args: {
    variant: "secondary",
    "aria-expanded": true,
    "aria-haspopup": "menu",
    children: (
      <>
        Options
        <ChevronDownIcon data-icon="inline-end" />
      </>
    ),
  },
};
