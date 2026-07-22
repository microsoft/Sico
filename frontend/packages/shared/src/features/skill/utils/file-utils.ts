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

import { unzipSync } from "fflate";

import type { SkillFile, SkillFileKind } from "../schemas/skill";

const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

// Cap total decompressed size so a malicious skill zip (a few MB compressed can
// inflate to gigabytes) can't OOM the tab. fflate's `filter` runs per entry
// before inflating, with the archive's declared `originalSize`, so we abort on
// the cumulative total before the bomb ever expands. A header that lies about
// its size could still slip past — a streaming byte counter would close that,
// tracked as a follow-up — but this stops the common case cheaply.
const MAX_UNZIPPED_BYTES = 200 * 1024 * 1024;

// Ceiling on a single asset download (the compressed archive or a lone file),
// bounding memory when the response has no / a lying content-length.
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// Lowercased final extension of a path/filename ("" when there's no dot).
export function extOf(path: string): string {
  return path.toLowerCase().split(".").pop() ?? "";
}

const TEXT_FILE_NAMES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "readme",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  "css",
  "csv",
  "env",
  "gitignore",
  "htm",
  "html",
  "ini",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "py",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  html: "html",
  htm: "html",
  css: "css",
  xml: "xml",
};

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  pdf: "application/pdf",
};

// Classifies a file path as a previewable image, pdf, or plain text.
export function detectFileKind(path: string): SkillFileKind {
  const ext = extOf(path);
  if (ext === "pdf") {
    return "pdf";
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  return "text";
}

// Returns the MIME type for a file path, defaulting to application/octet-stream.
export function mimeTypeForPath(path: string): string {
  return MIME_BY_EXTENSION[extOf(path)] ?? "application/octet-stream";
}

// Maps a file path to a syntax-highlighter language by its extension.
export function detectLanguage(path: string): string {
  return LANGUAGE_BY_EXTENSION[extOf(path)] ?? "text";
}

// Derives a display file name from a (possibly query-stringed) URL.
export function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url, "http://placeholder").pathname;
    const name = decodeURIComponent(pathname.split("/").pop() ?? "");
    if (name) {
      return name;
    }
  } catch {
    // ignore and fall back below
  }
  const name = url.split(/[?#]/)[0]?.split("/").pop() ?? "";
  return name || "file";
}

const SAFE_ASSET_URL_SCHEMES = new Set(["http:", "https:", "blob:"]);

// Guards an API-supplied asset URL before it feeds a fetch() or an anchor href.
// `skillVersionSchema.url` is only `z.string()`, so a malicious backend could
// return a `javascript:`/`data:` URL; restrict it to the schemes a download can
// legitimately use. Returns the url unchanged when safe, throws otherwise.
export function assertSafeAssetUrl(url: string): string {
  let scheme: string;
  try {
    scheme = new URL(url, window.location.origin).protocol;
  } catch {
    throw new Error("Invalid file url");
  }
  if (!SAFE_ASSET_URL_SCHEMES.has(scheme)) {
    throw new Error("Unsupported file url");
  }
  return url;
}

function isZipArchive(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b;
}

// Heuristically decides whether a buffer is text, using the extension first and
// then scanning a sample for NUL/control bytes (mirrors legacy isLikelyTextFile).
function isLikelyTextFile(path: string, data: Uint8Array): boolean {
  const fileName = path.split("/").pop()?.toLowerCase() ?? "";
  const ext = extOf(fileName);
  if (TEXT_FILE_NAMES.has(fileName) || TEXT_FILE_EXTENSIONS.has(ext)) {
    return true;
  }

  const sample = data.subarray(0, Math.min(data.length, 1024));
  if (sample.length === 0) {
    return true;
  }

  let controlBytes = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      controlBytes += 1;
    }
  }
  return controlBytes / sample.length < 0.1;
}

function decodeTextFile(path: string, data: Uint8Array): string {
  if (data.length > MAX_TEXT_PREVIEW_BYTES) {
    return "This file is too large to preview.";
  }
  if (!isLikelyTextFile(path, data)) {
    return "Binary file preview is not available.";
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}

function isSystemZipEntry(path: string): boolean {
  return path.startsWith("__MACOSX/") || path.endsWith("/");
}

// Removes a shared top-level directory (e.g. `repo-main/`) from all file paths.
function stripCommonRootDir(files: SkillFile[]): SkillFile[] {
  if (files.length === 0) {
    return files;
  }
  const firstSegment = files[0]?.path.split("/")[0];
  if (!firstSegment) {
    return files;
  }
  const allShareRoot = files.every((file) =>
    file.path.startsWith(`${firstSegment}/`),
  );
  if (!allShareRoot) {
    return files;
  }
  return files.map((file) => ({
    ...file,
    path: file.path.slice(firstSegment.length + 1),
  }));
}

function classifyEntry(path: string, bytes: Uint8Array): SkillFile {
  const kind = detectFileKind(path);
  if (kind === "image" || kind === "pdf") {
    return { path, content: "", kind, bytes };
  }
  if (isLikelyTextFile(path, bytes)) {
    return { path, content: decodeTextFile(path, bytes), kind: "text" };
  }
  return { path, content: "", kind: "binary", bytes };
}

// Parses a zip archive into preview files, dropping system entries, stripping a
// common root folder, and sorting by path.
function extractZipFiles(data: Uint8Array): SkillFile[] {
  let budget = MAX_UNZIPPED_BYTES;
  const entries = unzipSync(data, {
    filter: (file) => {
      // Charged before the entry is inflated; overflowing the budget aborts the
      // whole extraction so a zip bomb can't expand into memory.
      budget -= file.originalSize;
      if (budget < 0) {
        throw new Error("Skill archive is too large to open.");
      }
      return true;
    },
  });
  const files: SkillFile[] = [];
  for (const [rawPath, bytes] of Object.entries(entries)) {
    const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    // Skip system entries and any path with a `..` segment. Traversal isn't
    // exploitable here (paths only feed the preview tree, never the filesystem),
    // but dropping them avoids confusing/escaping tree nodes.
    if (!path || isSystemZipEntry(path) || path.split("/").includes("..")) {
      continue;
    }
    files.push(classifyEntry(path, bytes));
  }
  return stripCommonRootDir(files).sort((a, b) => a.path.localeCompare(b.path));
}

// Turns a downloaded buffer into preview files, supporting both zip archives and
// single files (mirrors legacy buildSkillFilesFromDownload).
export function buildSkillFilesFromDownload(
  data: Uint8Array,
  url: string,
): SkillFile[] {
  if (isZipArchive(data)) {
    return extractZipFiles(data);
  }
  return [classifyEntry(fileNameFromUrl(url), data)];
}

// Streams a response body while reporting download progress in the range [0, 1].
export async function readWithProgress(
  response: Response,
  onProgress: (progress: number) => void,
): Promise<Uint8Array> {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) {
    // No streamable body / no content-length: buffer it, but guard the size so
    // a missing header can't let a hostile endpoint stream unbounded into memory.
    onProgress(1);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) {
      throw new Error("Skill file is too large to open.");
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.length;
    // Abort past the cap even if content-length under-reported the real size.
    if (received > MAX_DOWNLOAD_BYTES) {
      void reader.cancel();
      throw new Error("Skill file is too large to open.");
    }
    chunks.push(value);
    onProgress(Math.min(received / total, 1));
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(1);
  return result;
}
