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

import { TooltipProvider } from "@sico/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  type AssetActionKind,
  AssetRow,
} from "@/features/projects/components/asset-row";
import {
  DocumentTypeSchema,
  ExtractionStatusSchema,
} from "@/features/projects/schemas/asset";
import type { AssetRow as AssetRowData } from "@/features/projects/types";
import { formatDateTime } from "@/features/projects/utils/format-date-time";

const doc = DocumentTypeSchema.enum;
const status = ExtractionStatusSchema.enum;

// A local-time value (no `Z`) → formatDateTime renders "2026-01-18 16:31"
// independent of the test runner's timezone.
const CREATED_AT = new Date("2026-01-18T16:31:00").getTime();

function makeKnowledge(
  partial: Partial<Extract<AssetRowData, { type: "knowledge" }>> = {},
): AssetRowData {
  return {
    type: "knowledge",
    id: 101,
    name: "Transforming with AI innovation",
    documentType: doc.FILE,
    status: status.INGESTED,
    tags: [],
    creator: { kind: "user", username: "Sarah Baker" },
    createdAt: CREATED_AT,
    ...partial,
  };
}

function makeExperience(
  partial: Partial<Extract<AssetRowData, { type: "experience" }>> = {},
): AssetRowData {
  return {
    type: "experience",
    id: 202,
    name: "Playbook Alpha",
    projectId: 1,
    tags: [],
    creator: { kind: "agent", agentInstanceId: 7 },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...partial,
  };
}

function makeDeliverable(
  partial: Partial<Extract<AssetRowData, { type: "deliverable" }>> = {},
): AssetRowData {
  return {
    type: "deliverable",
    id: 303,
    name: "report.md",
    createdAt: CREATED_AT,
    fileSasUrl: "https://sas/report.md",
    creator: { kind: "agent", agentInstanceId: 7, agentName: "Max" },
    ...partial,
  };
}

// A <tr> needs a table ancestor for valid DOM; the FAILED state mounts a Base
// UI Tooltip in the TYPE column, so wrap in TooltipProvider unconditionally.
function renderRow(
  row: AssetRowData,
  handlers: {
    onOpen?: (assetId: number) => void;
    onAction?: (kind: AssetActionKind) => void;
  } = {},
): ReturnType<typeof render> {
  return render(
    <TooltipProvider delayDuration={0}>
      <table>
        <tbody>
          <AssetRow
            row={row}
            onOpen={handlers.onOpen}
            onAction={handlers.onAction}
          />
        </tbody>
      </table>
    </TooltipProvider>,
  );
}

describe("<AssetRow>", () => {
  it("renders the ··· actions trigger for an Experience row (Delete)", () => {
    renderRow(makeExperience());

    expect(
      screen.getByRole("button", { name: "Asset actions" }),
    ).toBeInTheDocument();
  });

  it("an Experience's ··· menu lists Delete only", async () => {
    const user = userEvent.setup();
    renderRow(makeExperience());

    await user.click(screen.getByRole("button", { name: "Asset actions" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Delete"]);
  });

  it("an Experience's Delete emits onAction('delete')", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRow(makeExperience(), { onAction });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("renders the ··· actions trigger for a Deliverable row", () => {
    renderRow(makeDeliverable());

    expect(
      screen.getByRole("button", { name: "Asset actions" }),
    ).toBeInTheDocument();
  });

  it("a Deliverable's ··· menu lists Download then Delete", async () => {
    const user = userEvent.setup();
    renderRow(makeDeliverable());

    await user.click(screen.getByRole("button", { name: "Asset actions" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Download",
      "Delete",
    ]);
  });

  it("a Deliverable's Download emits onAction('download') when it has a file URL", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRow(makeDeliverable({ fileSasUrl: "https://sas/report.md" }), {
      onAction,
    });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Download" }));

    expect(onAction).toHaveBeenCalledWith("download");
  });

  it("a Deliverable's Delete emits onAction('delete')", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRow(makeDeliverable(), { onAction });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("a Deliverable's Download is disabled when it has no file URL", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRow(makeDeliverable({ fileSasUrl: null }), { onAction });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    const download = await screen.findByRole("menuitem", { name: "Download" });
    expect(download).toHaveAttribute("data-disabled");
    await user.click(download);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("an Experience row renders all 5 columns including the ACTIONS cell", () => {
    renderRow(makeExperience());

    // The ACTIONS column is shown for all categories now, so each row keeps its
    // trailing cell — 5 cells, matching the 5-column header.
    expect(screen.getAllByRole("cell")).toHaveLength(5);
  });

  // The first/last columns stay visible while the middle columns scroll
  // horizontally (sticky), inheriting the row's background so they never show
  // the scrolled content through them.
  it("pins the first column (ASSET NAME) to the left", () => {
    renderRow(makeKnowledge());
    const firstCell = screen.getAllByRole("cell")[0];
    expect(firstCell).toHaveClass("sticky", "left-0", "bg-inherit");
  });

  it("pins the last column (ACTIONS) to the right", () => {
    renderRow(makeKnowledge());
    const cells = screen.getAllByRole("cell");
    expect(cells[cells.length - 1]).toHaveClass(
      "sticky",
      "right-0",
      "bg-inherit",
    );
  });

  it("gives the row an opaque resting background for the pinned cells to inherit", () => {
    renderRow(makeKnowledge());
    expect(screen.getByRole("row")).toHaveClass("bg-surface-basic");
  });

  it("labels a Deliverable row 'Deliverable' in the TYPE column", () => {
    renderRow(makeDeliverable());

    expect(
      screen.getByRole("cell", { name: "Deliverable" }),
    ).toBeInTheDocument();
  });

  it("a Deliverable row is navigable: activating it fires onOpen(row.id)", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderRow(makeDeliverable({ id: 303, name: "Quarterly deck" }), { onOpen });

    await user.click(screen.getByRole("button", { name: "Quarterly deck" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(303);
  });

  it("renders the ··· actions trigger (capability slot) for a Knowledge row", () => {
    renderRow(makeKnowledge());

    expect(
      screen.getByRole("button", { name: "Asset actions" }),
    ).toBeInTheDocument();
  });

  it("a Knowledge file at status=INGESTED is navigable: activating the row fires onOpen(row.id)", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderRow(
      makeKnowledge({
        id: 555,
        name: "Ready doc",
        documentType: doc.FILE,
        status: status.INGESTED,
      }),
      { onOpen },
    );

    // The whole row is the nav element; its accessible name is the asset name,
    // which distinguishes it from the "Asset actions" ··· trigger.
    await user.click(screen.getByRole("button", { name: "Ready doc" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(555);
  });

  it('a Knowledge link row is clickable and opens the URL via onAction("open-link")', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onAction = vi.fn();
    // A link has no detail page, so activating the row opens the URL (open-link)
    // rather than navigating — onOpen must never fire for a link.
    renderRow(
      makeKnowledge({
        name: "Docs site",
        documentType: doc.LINK,
        status: status.INGESTED,
        linkUrl: "https://docs.example.test",
      }),
      { onOpen, onAction },
    );

    // The name is the focusable nav anchor (distinct from the ··· trigger).
    await user.click(screen.getByRole("button", { name: "Docs site" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("open-link");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a click on the row surface (outside the name) still navigates", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderRow(
      makeKnowledge({ id: 555, name: "Ready doc", status: status.INGESTED }),
      { onOpen },
    );

    // The whole row is a hit target: clicking a non-name cell (CREATOR) fires
    // the same navigation, proving the row-level onClick is wired.
    await user.click(screen.getByText("Sarah Baker"));

    expect(onOpen).toHaveBeenCalledWith(555);
  });

  it("clicking the ··· trigger does not also activate the row's onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderRow(makeKnowledge({ name: "Ready doc", status: status.INGESTED }), {
      onOpen,
    });

    // The trigger stops propagation, so opening the menu must not bubble up to
    // the row's navigation handler.
    await user.click(screen.getByRole("button", { name: "Asset actions" }));

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("falls back to a placeholder for an unnamed link with no linkUrl", () => {
    // An unnamed link with no URL has nothing to display; resolveName must
    // still surface a non-empty placeholder so the cell never renders blank.
    renderRow(
      makeKnowledge({
        name: "",
        documentType: doc.LINK,
        status: status.INGESTED,
        linkUrl: undefined,
      }),
    );

    expect(screen.getByText("Untitled link")).toBeInTheDocument();
  });

  it("renders the CREATED TIME cell via formatDateTime", () => {
    renderRow(makeKnowledge({ createdAt: CREATED_AT }));

    expect(screen.getByText(formatDateTime(CREATED_AT))).toBeInTheDocument();
    expect(screen.getByText("2026-01-18 16:31")).toBeInTheDocument();
  });

  it("shimmers the name while a Knowledge file is extracting (status=UPLOADED)", () => {
    const { container } = renderRow(
      makeKnowledge({
        name: "Extracting doc",
        documentType: doc.FILE,
        status: status.UPLOADED,
      }),
    );

    const name = screen.getByText("Extracting doc");
    expect(name).toHaveClass("shiny-text");
    expect(name).toHaveClass("animate-shimmer");
    // The sweep duration is set inline (width / speed); jsdom has no layout so
    // offsetWidth is 0 and the fallback 3s applies.
    expect(name).toHaveStyle({ animationDuration: "3s" });
    // A spinning loader sits beside the shimmering name (legacy parity).
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    // An extracting row is non-navigable: it is not a button and never fires nav.
    expect(screen.queryByRole("button", { name: "Extracting doc" })).toBeNull();
  });

  it("derives the leading icon from attachment.name, not the suffix-less display name", () => {
    // The display name has no extension (a real Chinese title), but the upload's
    // attachment name carries `.xlsx` → the table glyph, not the File fallback.
    const { container } = renderRow(
      makeKnowledge({
        name: "新建 Microsoft Excel Worksheet",
        documentType: doc.FILE,
        status: status.INGESTED,
        attachment: { name: "新建 Microsoft Excel Worksheet.xlsx" },
      }),
    );
    expect(container.querySelector(".tabler-icon-table")).toBeInTheDocument();
    expect(container.querySelector(".tabler-icon-file")).toBeNull();
  });

  it("a FAILED Knowledge file shows the red triangle + 'Extraction failed' in the TYPE column", async () => {
    const user = userEvent.setup();
    const { container } = renderRow(
      makeKnowledge({
        name: "Broken doc",
        documentType: doc.FILE,
        status: status.FAILED,
      }),
    );

    // The failed label replaces the plain "Knowledge" type and reads as one
    // danger unit via the semantic error token.
    const label = screen.getByText("Extraction failed");
    expect(label).toHaveClass("text-status-error-foreground");
    expect(screen.queryByText("Knowledge")).toBeNull();
    // The leading tile carries a red alert triangle (lucide-triangle-alert).
    expect(
      container.querySelector(".lucide-triangle-alert"),
    ).toBeInTheDocument();
    // No shimmer / loading status in the failed state.
    expect(screen.queryByRole("status", { name: "Loading" })).toBeNull();

    // Hover surfaces the re-upload tip.
    await user.hover(screen.getByRole("button", { name: "Extraction failed" }));
    expect(
      await screen.findByText(
        "Make sure the file's permission is open to public, then re-upload.",
      ),
    ).toBeInTheDocument();
  });

  it("a Knowledge file's ··· menu lists Edit / Download / Delete (no Open link)", async () => {
    const user = userEvent.setup();
    renderRow(makeKnowledge({ documentType: doc.FILE }));

    await user.click(screen.getByRole("button", { name: "Asset actions" }));

    // The file branch swaps in Download; the exact, ordered set proves Open
    // link is never rendered for a file.
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Edit",
      "Download",
      "Delete",
    ]);
    expect(screen.queryByRole("menuitem", { name: "Open link" })).toBeNull();
  });

  it("Download emits onAction('download') when the file has a blob URL", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRow(
      makeKnowledge({
        documentType: doc.FILE,
        attachment: { name: "report.xlsx", sasUrl: "/storage/1/report.xlsx" },
      }),
      { onAction },
    );

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Download" }));
    expect(onAction).toHaveBeenCalledWith("download");
  });

  it("Download is disabled when the file has no blob URL", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    // No `attachment` (so no sasUrl) → nothing to fetch → the item is disabled
    // rather than a clickable no-op.
    renderRow(makeKnowledge({ documentType: doc.FILE }), { onAction });

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    const download = await screen.findByRole("menuitem", { name: "Download" });
    expect(download).toHaveAttribute("data-disabled");
    await user.click(download);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("a Knowledge link's ··· menu lists Edit / Delete (no Download, no Open link)", async () => {
    const user = userEvent.setup();
    renderRow(
      makeKnowledge({
        documentType: doc.LINK,
        linkUrl: "https://docs.example.test",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Asset actions" }));

    // A link drops Download (no file to fetch); Open link moved to the row's
    // name click, so the menu is the bare Edit / Delete pair.
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Edit", "Delete"]);
    expect(screen.queryByRole("menuitem", { name: "Download" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open link" })).toBeNull();
  });

  it('clicking Edit in a Knowledge link\'s ··· menu emits onAction("edit")', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderRow(
      makeKnowledge({
        documentType: doc.LINK,
        linkUrl: "https://docs.example.test",
      }),
      { onAction },
    );

    await user.click(screen.getByRole("button", { name: "Asset actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("edit");
  });
});
