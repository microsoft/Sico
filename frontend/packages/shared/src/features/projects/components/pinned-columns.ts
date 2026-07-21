import { cn } from "@sico/ui/lib/utils.ts";

// The pinned (sticky) first/last columns of the assets table. Shared by the
// real rows (`asset-row.tsx`), the header (`assets-table-rows.tsx`), and the
// skeleton rows (`asset-row-skeleton.tsx`) so all three stay aligned when the
// table scrolls horizontally.
//
// `bg-inherit` makes a pinned cell adopt its row's own background, so it tracks
// the row hover/selected state instead of showing a fixed fill that breaks as
// the middle columns scroll under it (the row must carry an opaque resting
// background — `bg-surface-basic` — for there to be something to inherit).
//
// Frosted inner edge: the pinned cell's own fill fades to transparent over the
// last 24px adjacent to the scroll area (via `mask-image`), and
// `backdrop-blur-sm` softly blurs whatever scrolled content peeks through that
// transparent tail. Reads as a see-through hint that there's more behind the
// column, without hard-cutting content at the edge or obscuring the middle
// scroll area with a fill/shadow.
//
// The fade + blur are GATED on scroll state so the hint only shows while there
// is actually more to scroll that way (mirroring the old edge-shadow behaviour,
// and cheaper — `backdrop-blur` isn't painted at rest). `useTableScrollEdges`
// writes `data-scroll-start` / `data-scroll-end` onto the `group/table` wrapper;
// the left edge fades only when scrolled off the start (`scroll-start=false`),
// the right edge only when not yet at the end (`scroll-end=false`). At each
// extreme the near edge snaps back to a solid, un-blurred fill.
//
// `mask-clip: padding-box` scopes the mask to the padding box so the cell's
// `border-b` (drawn in the border box) stays fully opaque even inside the fade
// zone — otherwise the header/body divider gets masked away along with the
// fill and leaves a visible gap over the pinned columns.
const PIN_BASE = "sticky z-10 bg-inherit mask-clip-padding";
// The gated fade/blur pair per edge. Held as named constants (rather than inline
// in `cn()`) purely for readability — each string is long and repeated across the
// body + header variants, so naming it keeps the `cn()` call sites legible. The
// arbitrary `[mask-image:…]` value lints fine inside `cn()` (Tailwind v4 resolves
// arbitrary properties behind stacked variants); this is a formatting choice, not
// a lint workaround. `mask-image` and `backdrop-blur-sm` are gated together so a
// fully-scrolled edge paints neither.
const FADE_LEFT_EDGE =
  "group-data-[scroll-start=false]/table:backdrop-blur-sm group-data-[scroll-start=false]/table:[mask-image:linear-gradient(to_left,transparent,black_24px)]";
// Right column is only 44px wide with a ··· icon in the middle — the fade
// zone must stay smaller than the cell's left padding (8px) so it doesn't cut
// into the icon; 6px keeps a hint of peek-through without touching it.
const FADE_RIGHT_EDGE =
  "group-data-[scroll-end=false]/table:backdrop-blur-sm group-data-[scroll-end=false]/table:[mask-image:linear-gradient(to_right,transparent,black_6px)]";

// First column (ASSET NAME): pinned left; column auto-sizes to its widest
// content, capped at 200px so long names truncate instead of ballooning. Extra
// right padding (`pr-10` = 40px) leaves a 16px opaque buffer between the name's
// ellipsis and the 24px fade zone, so truncated text doesn't visually run into
// the blurred backdrop peek-through.
export const PIN_LEFT = cn(PIN_BASE, "left-0 max-w-50 pr-10", FADE_LEFT_EDGE);

// Last column (ACTIONS): pinned right, fixed narrow width (only the ··· button).
// `min-w-0` cancels @sico/ui `TableCell`'s default `min-w-16` so `w-11` (44px)
// isn't clamped up to 64px. Plain `min-w-0` (not `!min-w-0`) is enough: `cn()`
// (twMerge) resolves the `min-w-16`/`min-w-0` conflict and drops the default —
// an `!important` variant would instead read as a distinct class, leaving a dead
// `min-w-16` in the output that `!` then has to fight at the cascade.
export const PIN_RIGHT = cn(PIN_BASE, "right-0 w-11 min-w-0", FADE_RIGHT_EDGE);

// Header variants. The header row has no hover recolor, so the pinned header
// cells carry an explicit opaque fill (`bg-surface-basic`) rather than
// `bg-inherit`, and sit at `z-20` to cover the data rows' `z-10` pinned cells
// when the body scrolls under a (future) sticky header.
//
// `border-b border-divider` on the cell + `mask-clip-padding` (from
// `PIN_BASE` — repeated here for clarity) keeps the header/body divider
// visible across the pinned columns' full width, including the mask's fade
// zone (the mask clips to padding-box so the border sits outside it and stays
// unmasked). The header shares the same gated fade/blur as the body cells so
// the two stay visually aligned as the middle columns scroll.
const PIN_HEAD_BASE =
  "sticky z-20 bg-surface-basic border-b border-divider mask-clip-padding";
export const PIN_HEAD_LEFT = cn(
  PIN_HEAD_BASE,
  "left-0 max-w-50 pr-10",
  FADE_LEFT_EDGE,
);
export const PIN_HEAD_RIGHT = cn(
  PIN_HEAD_BASE,
  "right-0 w-11 min-w-0",
  FADE_RIGHT_EDGE,
);

// Non-pinned CREATOR column also caps at 200px so its width sizes to widest
// content (truncated by `CreatorCell`'s inner `truncate` span).
export const CREATOR_MAX = "max-w-50";
