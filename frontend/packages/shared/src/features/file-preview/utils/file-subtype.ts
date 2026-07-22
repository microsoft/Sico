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

// The previewable file subtypes the FilePreviewer dispatches on. Per the
// converged-taxonomy decision the top-level `kind` only says "file"; THIS
// decides which viewer renders it. `unknown` → the download-fallback state.
export type FileSubtype =
  | "office"
  | "pdf"
  | "image"
  | "video"
  | "markdown"
  | "text"
  | "html"
  | "glb"
  | "unknown";

// Extension → subtype table, ported 1:1 from legacy FileDrawer `getFileType`.
// Frozen so the lookup can't be mutated at runtime. NOTE: only 'html' maps (not
// 'htm') — legacy parity, deliberately.
const SUBTYPE_BY_EXTENSION: Readonly<Record<string, FileSubtype>> = {
  doc: "office",
  docx: "office",
  xls: "office",
  xlsx: "office",
  ppt: "office",
  pptx: "office",
  pdf: "pdf",
  glb: "glb",
  md: "markdown",
  txt: "text",
  html: "html",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  bmp: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  webm: "video",
  ogg: "video",
  mov: "video",
};

// Fixed base so the parse stays pure (legacy read `window.location.href`); only
// the pathname extension is read, so the host is irrelevant — a constant base
// just lets relative urls resolve and keeps the result deterministic.
const PARSE_BASE = "http://localhost/";

/**
 * Detect the previewable subtype from a file URL's extension — the ONE place
 * file subtype is decided (mirrors legacy FileDrawer `getFileType`). Pure: the
 * same url always yields the same subtype.
 *
 * Reads the extension off the parsed `pathname`, so a trailing query string
 * (e.g. an Azure SAS token `?sv=…`) never bleeds into it. A malformed url that
 * `new URL` can't parse is a deliberate fallback to `unknown` (the download
 * path), not a swallowed error.
 */
export function fileSubtype(url: string): FileSubtype {
  try {
    const { pathname } = new URL(url, PARSE_BASE);
    const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
    // Own-property check, not a bare bracket-then-`?? "unknown"`: a filename
    // ending in an Object.prototype key (`x.__proto__`, `x.constructor`) would
    // otherwise resolve to the prototype value — a non-FileSubtype that breaks
    // the return-type contract (mirrors iconForFilename's guard).
    return Object.hasOwn(SUBTYPE_BY_EXTENSION, ext)
      ? (SUBTYPE_BY_EXTENSION[ext] ?? "unknown")
      : "unknown";
  } catch {
    return "unknown";
  }
}
