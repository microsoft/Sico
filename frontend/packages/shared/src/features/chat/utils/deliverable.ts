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
  type FileTypeIcon,
  iconForFilename,
  UrlIcon,
} from "../../../utils/file-icon";
import type { SidepaneKind } from "../atoms/sidepane-atom";

// Wire `ToolDeliverableType`: only these three render — UNKNOWN / BATCH /
// ACQUIRED_SANDBOX are dropped from the renderable card list.
const MARKDOWN = 1;
const FILE = 2;
const WEB_PAGE_PREVIEW_URL = 3;
// Not a card: signals the agent acquired a live device. The previewer's
// auto-open watches for it (legacy `PlanCard` opened the Sandbox drawer on it).
const ACQUIRED_SANDBOX = 5;

export type RenderableDeliverable = {
  // Positional id synthesized from the source array index — deliverables carry
  // no id on the wire (mirrors plan.ts's step-id convention). The stable list key.
  id: string;
  label: string;
  isPreview: boolean;
  // 3-way wire discriminant the `isPreview` boolean collapsed away. The Sidepane
  // wiring picks a previewer per kind (markdown/webpage/file), so it needs the
  // full type back; `sandbox` is excluded — it comes from the header Device
  // button, never a deliverable card.
  kind: Exclude<SidepaneKind, "sandbox">;
  // webpage only — the raw preview SAS url (validated later by safeWebpageUrl).
  url?: string;
  // markdown only — body from the wire `markdownContent` (legacy parity), when
  // present; the title stays `label`.
  markdown?: string;
  // file only — the deliverable's SAS url (wire `fileUrl`), when present. The
  // FilePreviewer dispatches on its extension; `label` stays the filename.
  fileUrl?: string;
  // file only — the blob-relative uri (wire `file.fileUri`, e.g.
  // `default_space/0/x.md`), provided directly by the backend. "Add to project"
  // addresses the deliverable by this uri (POST /project/deliverable), so it is
  // taken verbatim rather than reverse-engineered from `fileUrl` (which the
  // deployment may rewrite to a host-relative path).
  fileUri?: string;
};

// Strip a deliverable download URL down to its blob-relative uri
// (`default_space/<pid>/<x>`), the form `POST /project/deliverable` addresses.
// Two deployment URL shapes reach here:
//   • DWP (Azure CDN):  `https://host/<env>/default_space/<pid>/<x>` — absolute,
//     with a leading env segment (`test`/`prod`) before the blob path.
//   • sico (nginx `sub_filter`): `/storage/default_space/<pid>/<x>` — a
//     same-origin RELATIVE path, so `new URL(path)` alone would throw.
// A malformed url degrades to "" (caller treats empty as "can't add").
function blobUriFromUrl(fileUrl: string): string {
  try {
    // Dummy base so a relative `/storage/...` path parses; never in the result.
    const { pathname } = new URL(fileUrl, "http://sico.invalid");
    const segments = pathname.replace(/^\//, "").split("/");
    // The blob uri starts at `default_space`. If it's already the first segment
    // keep it; otherwise drop the single leading prefix (DWP's `<env>` or sico's
    // nginx `storage` alias).
    if (segments[0] === "default_space") {
      return segments.join("/");
    }
    return segments.slice(1).join("/");
  } catch {
    return "";
  }
}

// Resolve the blob-relative uri of a FILE deliverable, preferring the structured
// wire field `file.fileUri` (verbatim, no parsing). It can be absent even when
// the file exists — a tool call that hasn't fully settled (`toolCallStatus`
// RUNNING) may emit the download `fileUrl` but not yet the nested `fileUri`. In
// that case fall back to reverse-parsing the top-level `fileUrl`. `in`-narrowing
// (no cast) mirrors the sibling wire reads; returns undefined when neither is
// usable so the "Add to project" action stays disabled.
function fileUriFromRaw(raw: object): string | undefined {
  const file =
    "file" in raw && typeof raw.file === "object" && raw.file !== null
      ? raw.file
      : undefined;
  if (
    file !== undefined &&
    "fileUri" in file &&
    typeof file.fileUri === "string" &&
    file.fileUri !== ""
  ) {
    return file.fileUri;
  }
  // Fallback: derive it from the top-level download url when present.
  if (
    "fileUrl" in raw &&
    typeof raw.fileUrl === "string" &&
    raw.fileUrl !== ""
  ) {
    const derived = blobUriFromUrl(raw.fileUrl);
    return derived === "" ? undefined : derived;
  }
  return undefined;
}

// Narrow one raw deliverable to the minimal renderable shape, or null for
// malformed / non-renderable entries. `in`-operator narrowing (no cast) — the
// store keeps `ToolCall.deliverables` as `unknown[]`, so each entry is validated.
function toRenderable(
  raw: unknown,
  index: number,
): RenderableDeliverable | null {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) {
    return null;
  }
  const id = String(index);
  if (raw.type === WEB_PAGE_PREVIEW_URL) {
    const url = "webPreviewSasUrl" in raw ? raw.webPreviewSasUrl : undefined;
    return {
      id,
      label: "Preview Page",
      isPreview: true,
      kind: "webpage",
      url: typeof url === "string" ? url : undefined,
    };
  }
  if (raw.type === MARKDOWN) {
    const title = "markdownTitle" in raw ? raw.markdownTitle : "";
    const body =
      "markdownContent" in raw && typeof raw.markdownContent === "string"
        ? raw.markdownContent
        : undefined;
    return {
      id,
      label: typeof title === "string" ? title : "",
      isPreview: false,
      kind: "markdown",
      markdown: body,
    };
  }
  if (raw.type === FILE) {
    const fileName = "fileName" in raw ? raw.fileName : "";
    const fileUrl =
      "fileUrl" in raw && typeof raw.fileUrl === "string"
        ? raw.fileUrl
        : undefined;
    return {
      id,
      label: typeof fileName === "string" ? fileName : "",
      isPreview: false,
      kind: "file",
      fileUrl,
      fileUri: fileUriFromRaw(raw),
    };
  }
  return null;
}

// Narrow a raw `unknown[]` of wire deliverables to the renderable shape both the
// per-step `<Deliverable>` chips and the turn-level `<PlanSummary>` cards draw
// from. Single source of truth for the enum + label derivation. Drops malformed
// entries; survivors keep their source-array index as `id`.
export function toRenderableDeliverables(
  deliverables: unknown[],
): RenderableDeliverable[] {
  return deliverables
    .map(toRenderable)
    .filter((d): d is RenderableDeliverable => d !== null);
}

// True if any raw deliverable signals an acquired sandbox (wire type 5). Drives
// the previewer's auto-open; `in`-narrowing (no cast) since the store keeps each
// entry as `unknown`. The `acquiredSandbox` body is NOT required — real seed
// data sends `{}` (qa.md), and the previewer needs only the agent id, not a
// sandboxId, so presence of the type alone is the trigger.
export function hasAcquiredSandbox(deliverables: unknown[]): boolean {
  return deliverables.some(
    (d) =>
      typeof d === "object" &&
      d !== null &&
      "type" in d &&
      d.type === ACQUIRED_SANDBOX,
  );
}

// Glyph for a deliverable card. A web preview (label "Preview Page", no
// extension) gets the website glyph; a FILE deliverable derives its icon from
// the filename — same `iconForFilename` system as user attachments, so a `.html`
// deliverable shows the globe, `.xlsx` a table, etc. (no longer a single
// hardcoded document glyph). Typed `FileTypeIcon` to feed `<FileTile icon>`.
export function deliverableIcon(
  deliverable: Pick<RenderableDeliverable, "isPreview" | "label">,
): FileTypeIcon {
  return deliverable.isPreview ? UrlIcon : iconForFilename(deliverable.label);
}
