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

// Per-row extraction visuals for a Knowledge overview row (§3 / §6 dec 3) are
// owned by `asset-row` directly: the shimmer rides the NAME (shiny-text clips to
// glyphs, so it must live on real text), the FAILED state swaps the leading icon
// tile for a red alert triangle, and the FAILED label + tip render in the TYPE
// column. This module exports the shared constants those surfaces use, plus the
// `<ShimmerName>` that owns the extracting-name shimmer.
import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX, useLayoutEffect, useRef, useState } from "react";

// §5 copy — verbatim.
export const FAILED_TEXT = "Extraction failed";
export const FAILED_TIP =
  "Make sure the file's permission is open to public, then re-upload.";

/**
 * Class applied to the asset NAME text while a Knowledge row is still extracting
 * (`status=UPLOADED`). `shiny-text` clips a moving sheen to the glyphs, so the
 * shimmer must live on the real name — which `asset-row` owns.
 */
export const shimmerNameClassName = "shiny-text animate-shimmer";

// The sheen sweeps at a constant linear speed (legacy parity: `width / speed`,
// speed 30 px/s), so the duration scales with the name width — long names sweep
// slowly, short names quickly. A fixed 1s would otherwise race across long names.
const SHIMMER_SPEED_PX_PER_S = 30;
// First paint, before the width is measured (mirrors legacy's useState(3)).
const FALLBACK_DURATION_S = 3;

/**
 * The extracting asset NAME — a shimmering `<span>` whose sweep duration is the
 * measured text width over a fixed linear speed, so it matches legacy's cadence
 * (the fixed-1s `animate-shimmer` raced on long names). The shimmer owns the
 * text color (`shiny-text` sets `color: transparent`), so callers must NOT also
 * apply `text-foreground-primary` here — that would repaint the glyphs solid.
 */
export function ShimmerName({
  name,
  className,
}: {
  name: string;
  className?: string;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const [durationS, setDurationS] = useState(FALLBACK_DURATION_S);
  useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 0;
    if (width > 0) {
      setDurationS(width / SHIMMER_SPEED_PX_PER_S);
    }
  }, [name]);
  return (
    <span
      ref={ref}
      className={cn(shimmerNameClassName, className)}
      style={{ animationDuration: `${durationS}s` }}
    >
      {name}
    </span>
  );
}
