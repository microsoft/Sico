import { cn } from "@sico/ui/lib/utils.ts";
import { Loader2, X } from "lucide-react";
import { createElement, type JSX, type KeyboardEvent } from "react";

import { type FileTypeIcon, iconForFilename } from "../../utils/file-icon";

export type FileTileProps = {
  filename: string;
  status?: "loading" | "ready";
  // Override the glyph. Defaults to the filename's extension
  // (`iconForFilename`); pass this when the icon is driven by something other
  // than the name — e.g. a deliverable that is a web preview, not a file.
  icon?: FileTypeIcon;
  removeLabel?: string;
  // Omit for a read-only tile (a sent attachment / plan deliverable): the
  // remove control is then not rendered at all.
  onRemove?: () => void;
  // Omit for a read-only tile. When set, the tile surface becomes activatable
  // (click + Enter/Space) — a deliverable card that opens the sidepane. Kept
  // independent of `onRemove`: deliverables activate, composer attachments
  // remove. Safe to pass both — the remove button stops propagation so its
  // click never bubbles into `onActivate`. Uses role="button"+tabIndex (not a
  // real <button>) so the remove pill stays a valid, un-nested button and the
  // tile keeps its div styling.
  onActivate?: () => void;
};

/**
 * Bordered file tile: a gray icon square + filename, with an optional
 * remove pill (shown at rest). The glyph is derived from the filename's
 * extension (`iconForFilename`) unless `icon` overrides it, swapped for a
 * spinner while `status === "loading"`. Without `onRemove` the tile is
 * read-only (no remove control).
 */
export function FileTile({
  filename,
  status = "ready",
  icon,
  removeLabel = "Remove file",
  onRemove,
  onActivate,
}: FileTileProps): JSX.Element {
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

  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className={cn(
        "group border-input-stroke-rest bg-surface-basic hover:border-input-stroke-hover relative flex h-12 w-56 items-center gap-2 rounded-xl border p-2",
        onActivate && "cursor-pointer",
      )}
    >
      {/* Dynamic file-type glyph via createElement — a value from
          iconForFilename, not a render-declared component (react-hooks/
          static-components). The flat tile supplies the gray fill (the
          bg-gradient-icon-fill token computes to none — globals.css:105). */}
      <div className="bg-surface-icon-tile flex size-7 shrink-0 items-center justify-center rounded-md">
        {status === "loading" ? (
          <Loader2
            data-testid="file-tile-loading"
            className="text-foreground-secondary size-4 animate-spin"
          />
        ) : (
          createElement(icon ?? iconForFilename(filename), {
            className: "text-foreground-secondary size-4",
          })
        )}
      </div>
      {/* `select-none`: the truncated name is a button label, not selectable
          copy. Without it, a click/drag forms a text selection and the browser
          scrolls this `overflow:hidden` (truncate) span to the selection focus,
          exposing the characters the ellipsis hid. */}
      <span className="leading-body text-foreground-primary min-w-0 flex-1 truncate pr-5 text-sm select-none">
        {filename.replace(/^#+\s*/, "")}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel}
          className="text-foreground-secondary absolute top-1 right-1 flex size-5 shrink-0 items-center justify-center rounded-sm opacity-80 hover:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            // Stop the click bubbling to the tile's `onActivate` — remove must
            // not also open the sidepane when both handlers are wired.
            event.stopPropagation();
            onRemove();
          }}
        >
          {/* Override the global LucideProvider stroke (1): the dismiss X reads
              too faint at 1 against the tile's icon glyphs (tabler @ 1.5), so it
              matches their weight. Scoped to the tile chrome — app lucide stays 1. */}
          <X className="size-4" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}
