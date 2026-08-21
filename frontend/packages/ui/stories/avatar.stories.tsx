import type { Meta, StoryObj } from "@storybook/react-vite";

import DW_DEFAULT_AVATAR_URL from "../src/assets/dw-default-avatar.svg?url";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "../src/components/ui/avatar";

/**
 * `<Avatar>` is the user-image shell. Drop an `<AvatarImage>` for the
 * picture and an `<AvatarFallback>` for the initials/icon fallback —
 * Base UI swaps between them automatically based on image loading
 * status. Stack avatars with `<AvatarGroup>` + `<AvatarGroupCount>`,
 * overlay a status dot with `<AvatarBadge>`. 1:1 port from shadcn
 * `base-nova` — `size` extended with `xs` / `2xl` for SICO use cases.
 */
const meta = {
  title: "Components/Avatar",
  component: Avatar,
  args: {
    size: "default",
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

const AVATAR_SRC_1 =
  "https://dwp-cdn-ddcqh0dkgnhbchgs.b01.azurefd.net/test/default_space/7625898113852506112.svg";
const AVATAR_SRC_2 =
  "https://dwp-cdn-ddcqh0dkgnhbchgs.b01.azurefd.net/test/default_space/7623327552261586944.svg";
const AVATAR_SRC_3 =
  "https://dwp-cdn-ddcqh0dkgnhbchgs.b01.azurefd.net/test/default_space/7623327641797394432.svg";
const AVATAR_SRC_4 =
  "https://dwp-cdn-ddcqh0dkgnhbchgs.b01.azurefd.net/test/default_space/7623327746659188736.svg";

/* ─── Default ────────────────────────────────────────────────── */

/**
 * Default appearance — image with `<AvatarFallback>` as backup. The
 * fallback only renders when the image fails to load.
 */
export const Default: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src={AVATAR_SRC_1} alt="Avatar 1" />
      <AvatarFallback>SC</AvatarFallback>
    </Avatar>
  ),
};

/* ─── Sizes — one story per cva size ─────────────────────────── */

/** `size="xs"` — 20px. Compact, for dense lists or inline mentions. */
export const ExtraSmall: Story = {
  args: { size: "xs" },
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>XS</AvatarFallback>
    </Avatar>
  ),
};

/** `size="sm"` — 24px. Comment threads, secondary lists. */
export const Small: Story = {
  args: { size: "sm" },
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>SM</AvatarFallback>
    </Avatar>
  ),
};

/** `size="default"` — 32px. The shadcn upstream default. */
export const DefaultSize: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>MD</AvatarFallback>
    </Avatar>
  ),
};

/** `size="lg"` — 40px. Profile rows, primary surfaces. */
export const Large: Story = {
  args: { size: "lg" },
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>LG</AvatarFallback>
    </Avatar>
  ),
};

/** `size="2xl"` — 48px. Hero profile cards. SICO-only extension. */
export const TwoXLarge: Story = {
  args: { size: "2xl" },
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>XL</AvatarFallback>
    </Avatar>
  ),
};

/* ─── Fallback content ───────────────────────────────────────── */

/**
 * `<AvatarFallback>` with text initials. Renders when no image is
 * provided or the image fails to load.
 */
export const FallbackInitials: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
};

/**
 * Broken image source — Base UI flips to `<AvatarFallback>`
 * automatically once the `<img>` fires `onerror`.
 */
export const BrokenImage: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarImage src="/this-image-does-not-exist.png" alt="missing" />
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
};

/**
 * Digital Worker default avatar — the SVG shipped from
 * `@sico/ui/assets/dw-default-avatar.svg`. Use this fallback for DW
 * surfaces (agents, system actors); use text initials for real users.
 */
export const DwDefaultFallback: Story = {
  render: (args) => (
    <Avatar {...args}>
      <AvatarFallback>
        <img src={DW_DEFAULT_AVATAR_URL} alt="" className="size-full" />
      </AvatarFallback>
    </Avatar>
  ),
};

/* ─── Badge ──────────────────────────────────────────────────── */

/**
 * `<AvatarBadge>` overlays a status dot bottom-right of the avatar.
 * Sized via `group-data-[size=*]/avatar:*` from the parent — see
 * each row.
 */
export const WithBadge: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {(["xs", "sm", "default", "lg", "2xl"] as const).map((size) => (
        <Avatar key={size} size={size}>
          <AvatarFallback>U</AvatarFallback>
          <AvatarBadge />
        </Avatar>
      ))}
    </div>
  ),
};

/* ─── Group ──────────────────────────────────────────────────── */

/**
 * `<AvatarGroup>` stacks avatars with `-space-x-2` and a 2px ring in
 * `--color-surface-basic` to separate them visually.
 */
export const Group: Story = {
  render: () => (
    <AvatarGroup>
      <Avatar>
        <AvatarImage src={AVATAR_SRC_2} alt="Avatar 2" />
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src={AVATAR_SRC_3} alt="Avatar 3" />
        <AvatarFallback>B</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src={AVATAR_SRC_4} alt="Avatar 4" />
        <AvatarFallback>C</AvatarFallback>
      </Avatar>
    </AvatarGroup>
  ),
};

/**
 * Add `<AvatarGroupCount>` after the avatars to show how many more
 * users are hidden. Inherits ring + tokens from the group.
 */
export const GroupWithCount: Story = {
  render: () => (
    <AvatarGroup>
      <Avatar>
        <AvatarImage src={AVATAR_SRC_2} alt="Avatar 2" />
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src={AVATAR_SRC_3} alt="Avatar 3" />
        <AvatarFallback>B</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarImage src={AVATAR_SRC_4} alt="Avatar 4" />
        <AvatarFallback>C</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  ),
};

/**
 * `<AvatarGroup>` across all five sizes. Each child `<Avatar>` carries
 * its own `size` prop — the group reads `data-size` from its child via
 * `group-has-data-[size=*]/avatar-group` to scale `<AvatarGroupCount>`
 * accordingly.
 */
export const GroupAllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(["xs", "sm", "default", "lg", "2xl"] as const).map((size) => (
        <AvatarGroup key={size}>
          <Avatar size={size}>
            <AvatarImage src={AVATAR_SRC_2} alt="Avatar 2" />
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
          <Avatar size={size}>
            <AvatarImage src={AVATAR_SRC_3} alt="Avatar 3" />
            <AvatarFallback>B</AvatarFallback>
          </Avatar>
          <Avatar size={size}>
            <AvatarImage src={AVATAR_SRC_4} alt="Avatar 4" />
            <AvatarFallback>C</AvatarFallback>
          </Avatar>
        </AvatarGroup>
      ))}
    </div>
  ),
};

/**
 * `<AvatarGroupCount>` scaling across all five sizes. The count cell
 * mirrors the Avatar shell — `xs:size-5` … `2xl:size-12` — and the
 * inner SVG scales in lockstep (`xs:size-2.5` … `2xl:size-6`).
 */
export const GroupWithCountAllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {(["xs", "sm", "default", "lg", "2xl"] as const).map((size) => (
        <AvatarGroup key={size}>
          <Avatar size={size}>
            <AvatarImage src={AVATAR_SRC_2} alt="Avatar 2" />
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
          <Avatar size={size}>
            <AvatarImage src={AVATAR_SRC_3} alt="Avatar 3" />
            <AvatarFallback>B</AvatarFallback>
          </Avatar>
          <Avatar size={size}>
            <AvatarImage src={AVATAR_SRC_4} alt="Avatar 4" />
            <AvatarFallback>C</AvatarFallback>
          </Avatar>
          <AvatarGroupCount>+3</AvatarGroupCount>
        </AvatarGroup>
      ))}
    </div>
  ),
};
