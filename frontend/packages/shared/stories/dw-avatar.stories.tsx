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
