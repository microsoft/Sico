import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  type AvatarSize,
  DW_DEFAULT_AVATAR_URL,
} from "@sico/ui";
import type { ReactElement } from "react";

import { safeIconUri } from "../../utils/safe-icon-uri";

type DwAvatarBase = {
  agent: { iconUri?: string | null };
  size?: AvatarSize;
};

/**
 * Either `label` (informative — read by screen readers) or
 * `decorative` (adjacent text already names the agent → image is
 * skipped via empty `alt`). Exactly one is required.
 */
export type DwAvatarProps =
  | (DwAvatarBase & { label: string; decorative?: never })
  | (DwAvatarBase & { decorative: true; label?: never });

/**
 * Digital Worker avatar. Falls back to the canonical DW default SVG
 * (DWs are not people — never name initials). No `className` escape
 * hatch; size via `size` prop.
 */
export function DwAvatar(props: DwAvatarProps): ReactElement {
  // eslint-disable-next-line react/destructuring-assignment -- discriminated union needs narrowing on `props`
  const { agent, size = "default" } = props;
  // eslint-disable-next-line react/destructuring-assignment -- discriminated union needs narrowing on `props`
  const alt = "decorative" in props && props.decorative ? "" : props.label;
  const src = safeIconUri(agent.iconUri ?? undefined);
  return (
    <Avatar size={size} data-testid="avatar-root">
      {src ? (
        <AvatarImage
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          data-testid="avatar-image"
        />
      ) : null}
      <AvatarFallback>
        <img
          src={DW_DEFAULT_AVATAR_URL}
          alt={alt}
          loading="lazy"
          className="size-full"
          data-testid="avatar-fallback-image"
        />
      </AvatarFallback>
    </Avatar>
  );
}
