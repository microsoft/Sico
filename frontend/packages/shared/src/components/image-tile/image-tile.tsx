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
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { type JSX, type KeyboardEvent, useState } from "react";

export type ImageTileProps = {
  src: string;
  alt: string;
  status?: "loading" | "ready";
  removeLabel?: string;
  // Omit for a read-only tile (a sent image attachment): the remove control is
  // then not rendered at all.
  onRemove?: () => void;
  // Omit for a non-interactive tile. When set, the tile surface becomes
  // activatable (click + Enter/Space) — a sent image attachment that opens the
  // sidepane preview. Mirrors FileTile.onActivate; `alt` is the button's
  // accessible name. role="button"+tabIndex (not a real <button>) so the remove
  // pill stays a valid, un-nested button.
  onActivate?: () => void;
};

/**
 * Image thumbnail tile: a fixed 48×48 square (object-cover) + an optional
 * remove pill (shown at rest) overlaid on the image. While
 * `status === "loading"` a frosted scrim + spinner covers the decoded image.
 * Without `onRemove` the tile is read-only (no remove control); with
 * `onActivate` the tile surface opens the sidepane on click or keyboard.
 */
export function ImageTile({
  src,
  alt,
  status = "ready",
  removeLabel = "Remove image",
  onRemove,
  onActivate,
}: ImageTileProps): JSX.Element {
  // Enter/Space mirror a native button's activation (role="button" gives no
  // key handling for free).
  const onKeyDown = onActivate
    ? (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }
    : undefined;

  // Track WHICH src failed, not a one-way boolean: a fresh/refreshed src (a
  // late-arriving or re-minted sasUrl) then auto-clears the fallback, instead of
  // latching broken forever and re-introducing the permanent broken thumbnail.
  // Empty/whitespace src: `<img>` won't fire onError in every browser, so treat
  // it as broken upfront.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = src.trim() === "" || failedSrc === src;

  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className={cn(
        "border-input-stroke-rest hover:border-input-stroke-hover relative inline-flex size-12 shrink-0 overflow-hidden rounded-xl border",
        onActivate && "cursor-pointer",
      )}
    >
      {/* Fixed 48×48 square (size-12) with object-cover — non-square sources
          are cropped to fill the tile rather than letter-boxed (design.md §4
          updated). The only loading affordance is the UPLOAD overlay — a
          frosted scrim + loader over the decoded image (Figma 19358:64568),
          driven solely by `status`. `referrerPolicy="no-referrer"` so a remote
          `src` (a history sasUrl) never leaks the page URL as a Referer to the
          host. */}
      {broken ? (
        <div
          role="img"
          aria-label={alt}
          className="bg-surface-icon-tile flex h-full w-full items-center justify-center"
        >
          {/* Override the global LucideProvider stroke (1) to 1.5 so the broken
              glyph matches the tile chrome's weight (see file-tile X). */}
          <ImageIcon className="text-icon-secondary size-4" strokeWidth={1.5} />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      )}
      {status === "loading" && (
        <div className="bg-surface-inverted/20 absolute inset-0 flex items-center justify-center backdrop-blur-sm">
          <Loader2
            data-testid="image-tile-loading"
            className="text-foreground-on-inverted size-4 animate-spin"
          />
        </div>
      )}
      {onRemove && (
        <>
          {/* A sand-12 top-edge gradient over a real photo so the white X
              dismiss stays legible on any image (the previous white scrim
              disappeared on bright photos). Always on — matches the X's
              rest-state opacity so the affordance doesn't pop on hover. The
              backdrop-blur is masked by the same top→bottom gradient so the
              strip's bottom edge fades out instead of cutting hard. The broken
              fallback already sits on a light surface, so no scrim. */}
          {!broken && (
            <div
              aria-hidden="true"
              // eslint-disable-next-line tailwindcss/no-custom-classname -- `from-overlay-tint-60` is a valid Tailwind v4 @theme token (var-aliased), unresolvable here because @sico/shared has no globals.css on the plugin's cssFiles path.
              className="from-overlay-tint-60 pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b to-transparent [mask-image:linear-gradient(to_bottom,black,transparent)] backdrop-blur-xs"
            />
          )}
          <button
            type="button"
            aria-label={removeLabel}
            className={cn(
              "absolute top-1 right-1 flex size-5 shrink-0 items-center justify-center rounded-sm opacity-80 hover:opacity-100 focus-visible:opacity-100",
              // White X over the sand-12 scrim on a real photo; secondary gray
              // on the broken fallback's light surface (matches FileTile).
              broken
                ? "text-foreground-secondary"
                : "text-foreground-on-inverted",
            )}
            onClick={(event) => {
              // Stop the click bubbling to the tile's `onActivate` — remove must
              // not also open the sidepane when both handlers are wired.
              event.stopPropagation();
              onRemove();
            }}
          >
            {/* Override the global LucideProvider stroke (1) to 1.5 — matches
                the tile chrome weight (see file-tile X). */}
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </>
      )}
    </div>
  );
}
