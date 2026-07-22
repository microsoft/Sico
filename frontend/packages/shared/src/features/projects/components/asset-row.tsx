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
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  TableCell,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import {
  Download,
  Ellipsis,
  Loader2,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { createElement } from "react";
import type * as React from "react";

import { CreatorCell } from "./creator-cell";
import { CREATOR_MAX, PIN_LEFT, PIN_RIGHT } from "./pinned-columns";
import { FAILED_TEXT, FAILED_TIP, ShimmerName } from "./poll-indicator";
import { iconForFilename } from "../../../utils/file-icon";
import { DocumentTypeSchema, ExtractionStatusSchema } from "../schemas/asset";
import type { AssetRow as AssetRowData } from "../types";
import { formatDateTime } from "../utils/format-date-time";

/**
 * The capability actions a row can fire (§3 / §5 copy), spanning all three
 * categories. From the `···` menu: Knowledge **file** → `edit` / `download` /
 * `delete`; Knowledge **link** → `edit` / `delete`; Deliverable → `download` /
 * `delete`; Experience → `delete`. `open-link` is NOT a menu item — a link row
 * fires it from the row-body click (no detail page). The row only emits the
 * kind; the consumer wires the items' dialogs.
 */
export type AssetActionKind = "edit" | "download" | "open-link" | "delete";

export type AssetRowProps = {
  row: AssetRowData;
  /**
   * Navigation seam. The row owns the navigability gate (§3) and only emits the
   * asset id when the row is navigable; the consumer wires the real
   * `/project/:id/asset/:assetId` navigation.
   */
  onOpen?: (assetId: number) => void;
  /**
   * Capability-menu seam (all categories). The `···` items emit their kind; the
   * consumer wires the items' dialogs / download.
   */
  onAction?: (kind: AssetActionKind) => void;
};

// Display name (§8 C): `name`, falling back to the link URL — then to an
// "Untitled link" placeholder — so an unnamed link row never renders a blank,
// non-navigable cell. Plain helper (not a component) so it never trips
// `react/no-multi-comp`.
function resolveName(row: AssetRowData): string {
  if (
    row.type === "knowledge" &&
    !row.name &&
    row.documentType === DocumentTypeSchema.enum.LINK
  ) {
    return row.linkUrl ?? "Untitled link";
  }
  return row.name;
}

// The filename the leading icon resolves from — NOT the display name, which is
// often a suffix-less title (`page503-…`). A Knowledge link uses its URL (→
// globe); a file uses `attachment.name` (the real upload name carrying the
// extension), falling back to the display name; an Experience playbook has no
// attachment, so its display name is used.
function iconSourceName(row: AssetRowData): string {
  if (row.type !== "knowledge") {
    return row.name;
  }
  if (row.documentType === DocumentTypeSchema.enum.LINK) {
    return row.linkUrl ?? "";
  }
  return row.attachment?.name ?? row.name;
}

// Navigability gate (§3 L163–166). The `status` gate is Knowledge-only — an
// Experience playbook is always clickable (opens its detail page). A Deliverable
// opens its published file, so it is navigable only when it carries one — a
// URL-less deliverable is inert rather than a clickable no-op.
function isNavigable(row: AssetRowData): boolean {
  if (row.type === "experience") {
    return true;
  }
  if (row.type === "deliverable") {
    return Boolean(row.fileSasUrl);
  }
  // A link Knowledge has no detail page; a file is navigable only once ready.
  return (
    row.documentType === DocumentTypeSchema.enum.FILE &&
    row.status === ExtractionStatusSchema.enum.INGESTED
  );
}

// The TYPE column content. A FAILED Knowledge extraction replaces the plain
// "Knowledge" label with a red `Extraction failed` unit + re-upload tooltip
// (§5 / §6 dec 3); otherwise the plain type label per row kind. Plain helper (no
// hooks) so the row component stays under the line ceiling.
function renderTypeCell(
  rowType: AssetRowData["type"],
  isFailed: boolean,
): React.JSX.Element | string {
  if (isFailed) {
    return (
      <Tooltip>
        <TooltipTrigger
          // The row is a button; a click on this tooltip must not also navigate.
          onClick={(event) => event.stopPropagation()}
          className="text-status-error-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <TriangleAlert className="size-4" />
          {FAILED_TEXT}
        </TooltipTrigger>
        <TooltipContent>{FAILED_TIP}</TooltipContent>
      </Tooltip>
    );
  }
  if (rowType === "experience") {
    return "Experience";
  }
  if (rowType === "deliverable") {
    return "Deliverable";
  }
  return "Knowledge";
}

// The leading artifact tile. A FAILED Knowledge extraction shows a red alert
// triangle on the error-fill tile; otherwise the file-type glyph (via the
// shared `iconForFilename`, same mapping <FileTile> uses — xlsx → table, pdf →
// file, link → globe) on the solid surface tile (Figma node 19456-11562). Plain
// helper (no hooks) so the row component stays under the line ceiling.
function renderArtifactTile(
  row: AssetRowData,
  isFailed: boolean,
): React.JSX.Element {
  if (isFailed) {
    return (
      <span className="bg-status-error-fill flex size-6 shrink-0 items-center justify-center rounded-md">
        <TriangleAlert className="text-status-error-foreground size-4" />
      </span>
    );
  }
  return (
    <span className="bg-surface-icon-tile flex size-6 shrink-0 items-center justify-center rounded-md">
      {createElement(iconForFilename(iconSourceName(row)), {
        className: "text-icon-primary size-4",
      })}
    </span>
  );
}

// The ASSET NAME cell content: the leading tile + the name. A navigable row
// renders the name as the keyboard / AT anchor `<button>` (stops propagation so
// it fires once, not also via the row's onClick); a non-navigable row renders a
// static name. An extracting row adds a spinner + sr-only loading status. Plain
// helper (no hooks) so the row component stays under the line ceiling.
function renderNameCell(
  row: AssetRowData,
  args: {
    name: string;
    interactive: boolean;
    isExtracting: boolean;
    isFailed: boolean;
    onActivate: () => void;
  },
): React.JSX.Element {
  const { name, interactive, isExtracting, isFailed, onActivate } = args;
  // Shared classes for the non-extracting name (button or static span). The
  // extracting name renders via <ShimmerName>, which owns its own color.
  const nameClassName = "text-foreground-primary leading-body min-w-0 truncate";
  // The name node: a shimmer while extracting, else a nav button (interactive)
  // or a static span. Computed here to keep the JSX free of nested ternaries.
  let nameNode: React.JSX.Element;
  if (isExtracting) {
    nameNode = (
      <ShimmerName name={name} className="leading-body min-w-0 truncate" />
    );
  } else if (interactive) {
    nameNode = (
      <button
        type="button"
        className={cn(nameClassName, "bg-transparent text-left")}
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
      >
        {name}
      </button>
    );
  } else {
    nameNode = <span className={nameClassName}>{name}</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      {renderArtifactTile(row, isFailed)}
      {nameNode}
      {isExtracting ? (
        <>
          {/* A spinner beside the shimmering name (legacy parity) — the visible
              loading affordance; the sr-only status announces it to AT. */}
          <Loader2
            aria-hidden="true"
            className="text-icon-secondary size-5 shrink-0 animate-spin"
          />
          <span role="status" aria-label="Loading" className="sr-only">
            Loading
          </span>
        </>
      ) : null}
    </div>
  );
}

// The `···` capability menu shared by all three categories (Knowledge,
// Deliverable, Experience). The trigger AND content stop propagation so opening
// the menu or picking an item never also navigates the row — Base UI portals
// the menu, but React replays its events through the component tree back to the
// row. `items` are the per-kind menu items. Plain helper (no hooks) so the row
// stays under the line ceiling.
function renderActionsMenu(items: React.ReactNode): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(event) => event.stopPropagation()}
        render={
          <Button variant="subtle" size="icon-sm" aria-label="Asset actions" />
        }
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The ACTIONS-column cell (§3 capability matrix). Knowledge → Edit / Download /
// Delete (a link drops Download — Open link moved to the row click); Deliverable
// → Download / Delete (its published file); Experience → Delete (View-only body,
// but the row can be removed). The row only emits the kind; the consumer wires
// the items' dialogs / download. Plain helper (no hooks) so the row stays under
// the line ceiling.
function renderActionsCell(
  row: AssetRowData,
  onAction?: (kind: AssetActionKind) => void,
): React.JSX.Element {
  let menu: React.JSX.Element;
  if (row.type === "knowledge") {
    const isLink = row.documentType === DocumentTypeSchema.enum.LINK;
    menu = renderActionsMenu(
      <>
        <DropdownMenuItem onClick={() => onAction?.("edit")}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        {isLink ? null : (
          // Downloads the uploaded blob via the browser (its same-origin
          // sasUrl). Disabled only when the blob URL is missing, so it is never
          // a clickable no-op.
          <DropdownMenuItem
            disabled={!row.attachment?.sasUrl}
            onClick={() => onAction?.("download")}
          >
            <Download />
            Download
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onAction?.("delete")}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </>,
    );
  } else if (row.type === "deliverable") {
    // The published file, saved straight from the browser. `fileSasUrl` is a
    // backend-issued SAS URL (typically a cross-origin blob host), scheme-gated
    // by `safeIconUri` at download time. Disabled when that URL is missing,
    // mirroring Knowledge. Delete removes the deliverable.
    menu = renderActionsMenu(
      <>
        <DropdownMenuItem
          disabled={!row.fileSasUrl}
          onClick={() => onAction?.("download")}
        >
          <Download />
          Download
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction?.("delete")}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </>,
    );
  } else {
    // Experience — the playbook body is read-only, but the row can be deleted.
    menu = renderActionsMenu(
      <DropdownMenuItem onClick={() => onAction?.("delete")}>
        <Trash2 />
        Delete
      </DropdownMenuItem>,
    );
  }
  return (
    <TableCell className={cn("px-2 text-right", PIN_RIGHT)}>{menu}</TableCell>
  );
}

/**
 * `AssetsTableSkeleton` shape: ASSET NAME / TYPE / CREATOR / CREATED TIME /
 * ACTIONS. Composes `<CreatorCell>`, the per-status artifact tile / TYPE-column
 * failed unit, and `formatDateTime`;
 * the surrounding `<Table>` is the table's (P1.1a) concern.
 *
 * **Navigability** is row-level: a navigable row (Knowledge **file** at
 * `status=INGESTED`, or any Experience) makes its whole surface a click target
 * that emits `onOpen(row.id)`; the name stays a real `<button>` so keyboard /
 * AT users keep a focusable Tab+Enter anchor, and the row's `onClick` is a
 * pointer-only convenience over the same handler. A Knowledge **link** row
 * activates `onAction("open-link")` instead (no detail page). A non-navigable
 * row (a file still extracting / failed) is static and `cursor-default`.
 *
 * **Capability slot** (§3 capability matrix): every category renders a `···`
 * `DropdownMenu` whose items emit `onAction(kind)` — Knowledge (file:
 * Edit/Download/Delete; link: Edit/Delete), Deliverable (Download/Delete),
 * Experience (Delete). Both `onOpen` and `onAction` are wired by the consumer.
 */
export function AssetRow({
  row,
  onOpen,
  onAction,
}: AssetRowProps): React.JSX.Element {
  const name = resolveName(row);
  const navigable = isNavigable(row);
  const isKnowledge = row.type === "knowledge";
  const isLink =
    isKnowledge && row.documentType === DocumentTypeSchema.enum.LINK;
  const isExtracting =
    isKnowledge && row.status === ExtractionStatusSchema.enum.UPLOADED;
  const isFailed =
    isKnowledge && row.status === ExtractionStatusSchema.enum.FAILED;

  // The whole row is the click target except a Knowledge file still extracting /
  // failed. A link has no detail page, so activating opens the URL in a new tab
  // (via the same `open-link` action the menu used to expose); a file / playbook
  // navigates to its detail route.
  const interactive = navigable || isLink;
  const handleActivate = (): void => {
    if (isLink) {
      onAction?.("open-link");
    } else {
      onOpen?.(row.id);
    }
  };

  const nameCell = renderNameCell(row, {
    name,
    interactive,
    isExtracting,
    isFailed,
    onActivate: handleActivate,
  });

  return (
    <TableRow
      // The row stays a semantic table row; the name <button> is the keyboard /
      // AT anchor (so Tab + Enter still work and the row keeps `role="row"`).
      // The row's onClick is a pointer-only convenience that fills the whole row
      // as a hit target, delegating to the same handler. Clicks inside the `···`
      // menu / failed tooltip stop propagation so they never also navigate.
      onClick={interactive ? handleActivate : undefined}
      className={cn(
        "bg-surface-basic h-16",
        interactive ? "cursor-pointer" : "cursor-default",
      )}
    >
      <TableCell className={cn("px-6", PIN_LEFT)}>{nameCell}</TableCell>
      <TableCell className="leading-body text-foreground-primary px-6">
        {renderTypeCell(row.type, isFailed)}
      </TableCell>
      <TableCell className={cn("px-6", CREATOR_MAX)}>
        <CreatorCell creator={row.creator} />
      </TableCell>
      <TableCell className="leading-body text-foreground-primary px-6 whitespace-nowrap">
        {formatDateTime(row.createdAt)}
      </TableCell>
      {renderActionsCell(row, onAction)}
    </TableRow>
  );
}
