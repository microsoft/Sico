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

import { UserAvatar } from "@/components/user-avatar";

const meta = {
  title: "Components/UserAvatar",
  component: UserAvatar,
  tags: ["autodocs"],
  args: {
    user: { name: "Shuyu Mao", iconUri: undefined },
    size: "default",
    decorative: false,
  },
} satisfies Meta<typeof UserAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No `iconUri` — falls back to initials on a hash-stable palette color. */
export const Default: Story = {};

/** Real icon URL provided by the API. */
export const WithIcon: Story = {
  args: {
    user: {
      name: "Shuyu Mao",
      iconUri: "https://api.dicebear.com/9.x/initials/svg?seed=shuyu",
    },
  },
};

/** Email-only user — initials derived from local-part. */
export const EmailOnly: Story = {
  args: { user: { email: "shuyu@sico.ai" } },
};

/** Broken / missing icon URL — `<AvatarImage>` won't render, fallback shows. */
export const BrokenIcon: Story = {
  args: {
    user: { name: "Shuyu Mao", iconUri: "https://invalid.example/x.png" },
  },
};

/** Size matrix mirrors `@sico/ui` Avatar tokens. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-3">
      <UserAvatar user={args.user} size="xs" />
      <UserAvatar user={args.user} size="sm" />
      <UserAvatar user={args.user} size="default" />
      <UserAvatar user={args.user} size="lg" />
      <UserAvatar user={args.user} size="2xl" />
    </div>
  ),
};

/** Decorative mode — adjacent text already names the user. */
export const Decorative: Story = {
  args: { decorative: true },
  render: (args) => (
    <div className="flex items-center gap-2">
      <UserAvatar
        user={args.user}
        size={args.size}
        decorative={args.decorative}
      />
      <span className="text-foreground-primary text-sm">{args.user.name}</span>
    </div>
  ),
};
