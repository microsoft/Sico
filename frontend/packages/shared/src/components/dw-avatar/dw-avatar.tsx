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
