import { describe, expect, it } from "vitest";

import {
  deliverableIcon,
  hasAcquiredSandbox,
  toRenderableDeliverables,
} from "@/features/chat/utils/deliverable";
import { iconForFilename, UrlIcon } from "@/utils/file-icon";

// Wire ToolDeliverable shapes (plan.proto types): MARKDOWN=1, FILE=2,
// WEB_PAGE_PREVIEW_URL=3; everything else (UNKNOWN / BATCH / ACQUIRED_SANDBOX)
// drops. The store keeps deliverables `unknown`, so the narrower validates each
// entry itself — these are the raw wire objects.
const file = {
  type: 2,
  fileName: "report.pdf",
  fileUrl: "https://x/report.pdf",
  // The blob-relative uri lives in the nested `file` submessage; the narrower
  // lifts `file.fileUri` to the top-level `fileUri` for "Add to project".
  file: {
    fileSasUrl: "https://x/report.pdf",
    fileUri: "default_space/0/report.pdf",
  },
};
const markdown = { type: 1, markdownTitle: "Summary" };
const markdownWithBody = {
  type: 1,
  markdownTitle: "Summary",
  markdownContent: "# Body",
};
const preview = { type: 3, webPreviewSasUrl: "https://x/p" };
const sandbox = { type: 5, sandboxId: "sb-1" };

describe("toRenderableDeliverables", () => {
  it("narrows a FILE deliverable to its fileName label and 'file' kind", () => {
    expect(toRenderableDeliverables([file])).toEqual([
      {
        id: "0",
        label: "report.pdf",
        isPreview: false,
        kind: "file",
        fileUrl: "https://x/report.pdf",
        fileUri: "default_space/0/report.pdf",
      },
    ]);
  });

  it("narrows a MARKDOWN deliverable to its markdownTitle label and 'markdown' kind", () => {
    // No `markdownContent` on the wire → the optional `markdown` body stays
    // absent (not an empty string), so downstream can distinguish "no body".
    expect(toRenderableDeliverables([markdown])).toEqual([
      { id: "0", label: "Summary", isPreview: false, kind: "markdown" },
    ]);
  });

  it("surfaces the markdown body from the wire markdownContent when present", () => {
    expect(toRenderableDeliverables([markdownWithBody])).toEqual([
      {
        id: "0",
        label: "Summary",
        isPreview: false,
        kind: "markdown",
        markdown: "# Body",
      },
    ]);
  });

  it("labels a WEB_PAGE_PREVIEW_URL deliverable 'Preview Page', flags isPreview, and surfaces its url + 'webpage' kind", () => {
    expect(toRenderableDeliverables([preview])).toEqual([
      {
        id: "0",
        label: "Preview Page",
        isPreview: true,
        kind: "webpage",
        url: "https://x/p",
      },
    ]);
  });

  it("omits the url when a WEB_PAGE_PREVIEW_URL deliverable carries no webPreviewSasUrl", () => {
    // Mirror of the markdown-no-body case: the optional `url` stays absent (not
    // an empty string) when the wire omits it, so the kind is still resolvable.
    expect(toRenderableDeliverables([{ type: 3 }])).toEqual([
      { id: "0", label: "Preview Page", isPreview: true, kind: "webpage" },
    ]);
  });

  it("drops non-renderable types (e.g. sandbox)", () => {
    expect(toRenderableDeliverables([sandbox])).toEqual([]);
  });

  it("keeps the source index as the id while dropping the rest", () => {
    // markdown is at source index 2 → its id is "2", not "1" — the positional
    // id mirrors the schema's own `id: String(index)` step convention.
    expect(toRenderableDeliverables([file, sandbox, markdown])).toEqual([
      {
        id: "0",
        label: "report.pdf",
        isPreview: false,
        kind: "file",
        fileUrl: "https://x/report.pdf",
        fileUri: "default_space/0/report.pdf",
      },
      { id: "2", label: "Summary", isPreview: false, kind: "markdown" },
    ]);
  });

  it("leaves fileUri undefined when the FILE deliverable has no usable file submessage", () => {
    // fileUriFromRaw degrades to undefined for every non-conforming shape when
    // there is also no top-level `fileUrl` to fall back to: absent `file`,
    // non-object `file` (null / primitive), and a `file` whose `fileUri` is
    // missing or non-string. All keep `fileUrl` (when present) so the file still
    // previews/downloads — only "Add to project" is unavailable.
    expect(
      toRenderableDeliverables([
        { type: 2, fileName: "a.pdf" }, // no `file`, no `fileUrl`
        { type: 2, fileName: "b.pdf", file: null }, // non-object `file`
        { type: 2, fileName: "c.pdf", file: { fileUri: 42 } }, // non-string uri
        { type: 2, fileName: "d.pdf", file: {} }, // `file` without `fileUri`
      ]),
    ).toEqual([
      { id: "0", label: "a.pdf", isPreview: false, kind: "file" },
      { id: "1", label: "b.pdf", isPreview: false, kind: "file" },
      { id: "2", label: "c.pdf", isPreview: false, kind: "file" },
      { id: "3", label: "d.pdf", isPreview: false, kind: "file" },
    ]);
  });

  it("derives fileUri from the top-level fileUrl when file.fileUri is missing", () => {
    // A tool call that hasn't fully settled (toolCallStatus RUNNING) can emit the
    // download `fileUrl` but not the nested `file.fileUri`. Reverse-parse the url
    // so "Add to project" still works. Covers both deployment url shapes:
    //   • sico: same-origin relative `/storage/default_space/...`
    //   • DWP:  absolute Azure CDN `https://host/<env>/default_space/...`
    expect(
      toRenderableDeliverables([
        {
          type: 2,
          fileName: "sico.md",
          fileUrl: "/storage/default_space/1/abc.md",
          file: { fileSasUrl: "/storage/default_space/1/abc.md" }, // no fileUri
        },
        {
          type: 2,
          fileName: "dwp.md",
          fileUrl: "https://cdn.example/test/default_space/0/xyz.md",
          file: { fileName: "dwp.md" }, // no fileUri
        },
        {
          type: 2,
          fileName: "empty.md",
          fileUrl: "",
          file: { fileUri: "" }, // both empty → undefined
        },
      ]),
    ).toEqual([
      {
        id: "0",
        label: "sico.md",
        isPreview: false,
        kind: "file",
        fileUrl: "/storage/default_space/1/abc.md",
        fileUri: "default_space/1/abc.md",
      },
      {
        id: "1",
        label: "dwp.md",
        isPreview: false,
        kind: "file",
        fileUrl: "https://cdn.example/test/default_space/0/xyz.md",
        fileUri: "default_space/0/xyz.md",
      },
      {
        id: "2",
        label: "empty.md",
        isPreview: false,
        kind: "file",
        fileUrl: "",
      },
    ]);
  });

  it("prefers file.fileUri over the fileUrl fallback when both are present", () => {
    expect(
      toRenderableDeliverables([
        {
          type: 2,
          fileName: "both.md",
          fileUrl: "/storage/default_space/1/fromurl.md",
          file: { fileUri: "default_space/1/fromfield.md" },
        },
      ]),
    ).toEqual([
      {
        id: "0",
        label: "both.md",
        isPreview: false,
        kind: "file",
        fileUrl: "/storage/default_space/1/fromurl.md",
        fileUri: "default_space/1/fromfield.md",
      },
    ]);
  });

  it("falls back to an empty label when the title/name field is missing or non-string", () => {
    expect(
      toRenderableDeliverables([{ type: 1 }, { type: 2, fileName: 42 }]),
    ).toEqual([
      { id: "0", label: "", isPreview: false, kind: "markdown" },
      { id: "1", label: "", isPreview: false, kind: "file" },
    ]);
  });

  it("ignores malformed entries that are not type-bearing objects", () => {
    expect(toRenderableDeliverables([null, "x", 42, {}])).toEqual([]);
  });

  it("returns an empty array for no deliverables", () => {
    expect(toRenderableDeliverables([])).toEqual([]);
  });
});

describe("hasAcquiredSandbox", () => {
  it("is true when any deliverable is an acquired sandbox (type 5)", () => {
    expect(hasAcquiredSandbox([file, sandbox])).toBe(true);
  });

  it("matches a sandbox even with an empty acquiredSandbox body (real seed data)", () => {
    expect(hasAcquiredSandbox([{ type: 5, acquiredSandbox: {} }])).toBe(true);
  });

  it("is false when no deliverable is a sandbox", () => {
    expect(hasAcquiredSandbox([file, markdown, preview])).toBe(false);
  });

  it("is false for an empty list", () => {
    expect(hasAcquiredSandbox([])).toBe(false);
  });

  it("ignores malformed (non-object / type-less) entries", () => {
    expect(hasAcquiredSandbox([null, "x", 42, {}])).toBe(false);
  });
});

describe("deliverableIcon", () => {
  it("uses the globe for a web-preview deliverable (label has no extension)", () => {
    expect(deliverableIcon({ isPreview: true, label: "Preview Page" })).toBe(
      UrlIcon,
    );
  });

  it("derives a file deliverable's icon from its filename extension", () => {
    // A FILE deliverable now matches the user-attachment icon system: by
    // extension, not a single hardcoded document glyph.
    expect(deliverableIcon({ isPreview: false, label: "page.html" })).toBe(
      UrlIcon,
    );
    expect(deliverableIcon({ isPreview: false, label: "report.pdf" })).toBe(
      iconForFilename("report.pdf"),
    );
    expect(deliverableIcon({ isPreview: false, label: "data.xlsx" })).toBe(
      iconForFilename("data.xlsx"),
    );
    expect(deliverableIcon({ isPreview: false, label: "notes.docx" })).toBe(
      iconForFilename("notes.docx"),
    );
  });
});
