import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  type AvatarSize,
  PROJECT_DEFAULT_AVATAR_URL,
} from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import type { ReactElement } from "react";

import { safeIconUri } from "../../utils/safe-icon-uri";

// Projects use a rounded-square avatar (people/DWs are circular). The corner
// radius is derived from `size` — small avatars get a tighter `md`, larger
// ones `lg` — so callers never pass it. Literal class strings (not
// `rounded-${radius}`) keep them scannable by Tailwind. `after:` rounds the
// Avatar's ring overlay to match.
const SIZE_RADIUS: Record<AvatarSize, "md" | "lg"> = {
  xs: "md",
  sm: "md",
  default: "lg",
  lg: "lg",
  "2xl": "lg",
};
const RADIUS_CLASS = {
  md: "rounded-md after:rounded-md",
  lg: "rounded-lg after:rounded-lg",
} as const;
const IMAGE_RADIUS_CLASS = {
  md: "rounded-md",
  lg: "rounded-lg",
} as const;

type ProjectAvatarBase = {
  project: { iconUrl?: string | null };
  size?: AvatarSize;
  // A locally-created, already-trusted image URL (e.g. an upload preview's
  // `blob:` objectURL) that bypasses `safeIconUri`. Use ONLY for URLs the app
  // minted itself via `URL.createObjectURL` — never for network-sourced values.
  // When set it takes precedence over `project.iconUrl`.
  previewSrc?: string;
};

/**
 * Either `label` (informative — read by screen readers) or `decorative`
 * (adjacent text already names the project → image is skipped via empty
 * `alt`). Exactly one is required.
 */
export type ProjectAvatarProps =
  | (ProjectAvatarBase & { label: string; decorative?: never })
  | (ProjectAvatarBase & { decorative: true; label?: never });

/**
 * Project avatar — rounded-square, falls back to the canonical project default
 * asset. Mirrors `DwAvatar`; the corner radius follows `size`.
 */
export function ProjectAvatar(props: ProjectAvatarProps): ReactElement {
  // eslint-disable-next-line react/destructuring-assignment -- discriminated union needs narrowing on `props`
  const { project, size = "default", previewSrc } = props;
  // eslint-disable-next-line react/destructuring-assignment -- discriminated union needs narrowing on `props`
  const alt = "decorative" in props && props.decorative ? "" : props.label;
  const radius = SIZE_RADIUS[size];
  // `previewSrc` is a caller-trusted local blob; only network-sourced iconUrl
  // goes through the safe-URL guard.
  const src = previewSrc ?? safeIconUri(project.iconUrl ?? undefined);
  return (
    <Avatar size={size} className={RADIUS_CLASS[radius]}>
      {src ? (
        <AvatarImage
          key={src}
          src={src}
          alt={alt}
          className={IMAGE_RADIUS_CLASS[radius]}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      {/* The default asset is a full-bleed rounded tile; `bg-transparent`
          drops the fallback's initials background so its color can't peek
          through the SVG's transparent corners (a radius mismatch otherwise
          shows a sliver of `bg-surface-sunken` — "露底"). */}
      <AvatarFallback className={cn("bg-transparent", IMAGE_RADIUS_CLASS[radius])}>
        <img
          src={PROJECT_DEFAULT_AVATAR_URL}
          alt={alt}
          loading="lazy"
          className="size-full"
        />
      </AvatarFallback>
    </Avatar>
  );
}
