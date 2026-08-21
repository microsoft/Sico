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
