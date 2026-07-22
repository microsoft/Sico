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

import { cn } from "@sico/ui/lib/utils.ts";
import { type CSSProperties, memo, type ReactElement } from "react";

// Initial-based dashed circle (NOT an image): the first letter of `name`,
// uppercased. Ported from the legacy `DigitalWorkerAvatar` — the palette is
// picked from the initial's char code (A-I / J-R / S-Z), matching the Figma
// Studio card avatars. Colors/size are inline styles to reproduce the exact
// hex without Tailwind arbitrary-value lint.
const AVATAR_PALETTES = [
  { border: "#C6D0DA", background: "#F3F4F6", color: "#424A52" },
  { border: "#BCB8FF", background: "#F5F3FF", color: "#3B32B3" },
  { border: "#C6D0DA", background: "#EBF5FF", color: "#004C8E" },
] as const;

function getPaletteByInitial(
  initial: string,
): (typeof AVATAR_PALETTES)[number] {
  const code = initial.charCodeAt(0);
  if (code >= 74 && code <= 82) {
    return AVATAR_PALETTES[1];
  }
  if (code >= 83 && code <= 90) {
    return AVATAR_PALETTES[2];
  }
  return AVATAR_PALETTES[0];
}

export type DwInitialAvatarProps = {
  name: string;
  size?: number;
  fontSize?: number;
  className?: string;
  decorative?: boolean;
};

function DwInitialAvatarImpl({
  name,
  size = 40,
  fontSize = 16,
  className,
  decorative = false,
}: DwInitialAvatarProps): ReactElement {
  const initial = name.trim().charAt(0).toUpperCase();
  const palette = getPaletteByInitial(initial);
  const style: CSSProperties = {
    width: size,
    height: size,
    fontSize,
    borderColor: palette.border,
    background: palette.background,
    color: palette.color,
  };

  return (
    <div
      aria-hidden={decorative || undefined}
      style={style}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-dashed font-medium",
        className,
      )}
    >
      {initial}
    </div>
  );
}

export const DwInitialAvatar = memo(DwInitialAvatarImpl);
