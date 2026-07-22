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
import { Bell } from "lucide-react";
import type { ReactElement } from "react";

import { NavBadge } from "@/features/sidebar/components/nav-badge";
import { NavRow } from "@/features/sidebar/components/nav-row";
import { RailNavRow } from "@/features/sidebar/components/rail-nav-row";

// `NavRow`/`RailNavRow`/`NavBadge` are presentational primitives a downstream
// app composes into the sidebar's `menuTopExtras` slot (e.g. dwp's Notification
// row). They take a caller-supplied `render` element; these stories use a plain
// `<button>` so no router is needed. The width-60/11 wrappers mimic the
// expanded sidebar / collapsed rail so spacing reads true.
type StoryArgs = { unread: number };

function ExpandedFrame({
  children,
}: {
  readonly children: ReactElement;
}): ReactElement {
  return <div className="bg-surface-basic w-60 p-2">{children}</div>;
}

function RailFrame({
  children,
}: {
  readonly children: ReactElement;
}): ReactElement {
  return (
    <div className="bg-surface-basic flex w-11 flex-col items-center p-1">
      {children}
    </div>
  );
}

const meta: Meta<StoryArgs> = {
  title: "Components/Sidebar/NavRow",
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: { unread: 3 },
};
export default meta;
type Story = StoryObj<StoryArgs>;

/** Expanded row with an icon + label, the resting (non-active) state. */
export const Default: Story = {
  render: () => (
    <ExpandedFrame>
      <NavRow
        icon={<Bell aria-hidden className="size-5" />}
        label="Notification"
        render={<button type="button" />}
      />
    </ExpandedFrame>
  ),
};

/** Active state — the row carries the selected-surface highlight. */
export const Active: Story = {
  render: () => (
    <ExpandedFrame>
      <NavRow
        icon={<Bell aria-hidden className="size-5" />}
        label="Notification"
        active
        render={<button type="button" />}
      />
    </ExpandedFrame>
  ),
};

/** Trailing count badge — the dwp Notification row with an unread count. */
export const WithBadge: Story = {
  render: (args) => (
    <ExpandedFrame>
      <NavRow
        icon={<Bell aria-hidden className="size-5" />}
        label="Notification"
        trailing={<NavBadge>{args.unread > 99 ? "99+" : args.unread}</NavBadge>}
        render={<button type="button" />}
      />
    </ExpandedFrame>
  ),
};

/** Collapsed-rail variant — icon only, label exposed via `aria-label`. */
export const Rail: Story = {
  render: () => (
    <RailFrame>
      <RailNavRow
        icon={<Bell aria-hidden className="size-5" />}
        render={<button type="button" aria-label="Notifications" />}
      />
    </RailFrame>
  ),
};

/** `NavBadge` in isolation — the compact count pill at 1 and 99+. */
export const Badge: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <NavBadge>1</NavBadge>
      <NavBadge>99+</NavBadge>
    </div>
  ),
};
