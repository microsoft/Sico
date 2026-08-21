import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from "@sico/ui";
import type { ReactElement } from "react";

import { safeIconUri } from "../../utils/safe-icon-uri";

type UserLike = {
  name?: string;
  email?: string;
  iconUri?: string | null;
};

type UserAvatarProps = {
  user: UserLike;
  size?: AvatarSize;
  /** Empty `alt` when adjacent text already names the user. */
  decorative?: boolean;
};

// TODO: Lift into @sico/ui semantic tokens once the broader avatar
// palette story is decided. Ported from sico-frontend-old to give each
// user a stable color rather than a single shared gradient.
const FALLBACK_PALETTE = ["#2D3339", "#625F90", "#C4BFFF"] as const;

function pickInitials(seed: string): string {
  if (!seed) {
    return "?";
  }
  const uppers = seed.match(/[A-Z]/g)?.slice(0, 2).join("") ?? "";
  if (uppers) {
    return uppers;
  }
  return seed.slice(0, 2).toUpperCase();
}

function pickColor(seed: string): string {
  const idx = seed ? seed.charCodeAt(0) % FALLBACK_PALETTE.length : 0;
  return FALLBACK_PALETTE[idx] ?? FALLBACK_PALETTE[0];
}

/**
 * Human user avatar. Falls back to user-name initials (max 2 letters,
 * upper-case first) on a hash-stable color from FALLBACK_PALETTE.
 * Companion to <DwAvatar> for digital workers. No `className` escape
 * hatch; size via `size` prop.
 */
export function UserAvatar({
  user,
  size = "default",
  decorative = false,
}: UserAvatarProps): ReactElement {
  const seed = user.name ?? user.email?.split("@")[0] ?? "";
  const alt = decorative ? "" : seed;
  const initials = pickInitials(seed);
  const color = pickColor(seed);
  const src = safeIconUri(user.iconUri ?? undefined);
  return (
    <Avatar size={size} data-testid="avatar-root">
      {src ? <AvatarImage src={src} alt={alt} /> : null}
      <AvatarFallback
        className="text-foreground-on-inverted"
        style={{ backgroundColor: color }}
        data-testid="avatar-fallback"
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
