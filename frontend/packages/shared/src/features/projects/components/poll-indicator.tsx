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
