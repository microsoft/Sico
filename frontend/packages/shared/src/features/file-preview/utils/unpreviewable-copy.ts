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

import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

// Shared "this file can't be previewed" copy + illustration, used by every
// viewer that falls back to a download/unsupported state (pdf, glb, markdown-file
// load failure, and the unknown-subtype UnsupportedViewer). Kept in one place so
// a copy edit can't silently diverge across the call sites.
export const UNPREVIEWABLE_COPY = {
  heading: "Preview not supported for this file type.",
  body: "Download the file to view its contents.",
} as const;

// The shared no-preview illustration + its intrinsic size. Sourced from the
// shared illustration registry (the `noPreview` style) so the asset can't drift
// across call sites.
export const UNPREVIEWABLE_ILLUSTRATION = EMPTY_ILLUSTRATIONS.noPreview;
