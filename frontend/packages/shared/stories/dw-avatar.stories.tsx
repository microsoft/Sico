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

import { DwAvatar } from "@/components/dw-avatar";

const meta = {
  title: "Components/DwAvatar",
  component: DwAvatar,
  tags: ["autodocs"],
  args: {
    agent: { iconUri: undefined },
    label: "Atlas Agent",
    size: "default",
  },
} satisfies Meta<typeof DwAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No `iconUri` — falls back to the canonical DW default SVG. */
export const Default: Story = {};

/** Real icon URL provided by the API. */
export const WithIcon: Story = {
  args: {
    agent: { iconUri: "https://api.dicebear.com/9.x/shapes/svg?seed=atlas" },
  },
};

/** Broken / missing icon URL — `<AvatarImage>` won't render, fallback shows. */
export const BrokenIcon: Story = {
  args: {
    agent: { iconUri: "https://invalid.example/x.png" },
  },
};

/** Size matrix mirrors `@sico/ui` Avatar tokens. */
export const Sizes: Story = {
  render: (args) => {
    // Storybook widens `label` to `string | undefined` because the
    // labelled / decorative branches of the discriminated union make
    // it optional in aggregate. The meta-level default guarantees a
    // value at runtime, but we narrow here instead of `!`-asserting.
    const label = args.label ?? "Atlas Agent";
    return (
      <div className="flex items-end gap-3">
        <DwAvatar agent={args.agent} label={label} size="xs" />
        <DwAvatar agent={args.agent} label={label} size="sm" />
        <DwAvatar agent={args.agent} label={label} size="default" />
        <DwAvatar agent={args.agent} label={label} size="lg" />
        <DwAvatar agent={args.agent} label={label} size="2xl" />
      </div>
    );
  },
};

/** Decorative mode — adjacent text already names the agent. */
export const Decorative: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <DwAvatar agent={args.agent} size={args.size} decorative />
      <span className="text-foreground-primary text-sm">{args.label}</span>
    </div>
  ),
};
