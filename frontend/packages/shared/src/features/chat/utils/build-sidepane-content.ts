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

import { type RenderableDeliverable } from "./deliverable";
import { type SidepaneContent } from "../atoms/sidepane-atom";

// The ONE place a parsed deliverable becomes sidepane content (design decision
// S3): legacy duplicated this card→drawer mapping across 3 card components; D1
// centralizes it here so a new kind is mapped in a single spot.
export function buildSidepaneContent(
  deliverable: RenderableDeliverable,
): SidepaneContent {
  switch (deliverable.kind) {
    case "markdown":
      // `?? ""` — a markdown deliverable may carry no body; the viewer renders
      // an empty doc rather than the string "undefined".
      return {
        kind: "markdown",
        title: deliverable.label,
        markdown: deliverable.markdown ?? "",
      };
    case "webpage":
      // `?? ""` — url validation is the WebpagePreviewer's job (safeWebpageUrl);
      // an empty url flows through to its blocked state, not validated here.
      return { kind: "webpage", url: deliverable.url ?? "" };
    case "file":
      // `?? ""` — subtype detection / unsupported fallback is the FilePreviewer's
      // job (fileSubtype); an empty url flows through to its unknown branch, not
      // validated here (mirrors the webpage `?? ""`). `canAddToProject` — a
      // deliverable file is DW-produced, so its preview offers "Add to project"
      // (a user-uploaded attachment opens `kind:"file"` directly, without it).
      return {
        kind: "file",
        filename: deliverable.label,
        fileUrl: deliverable.fileUrl ?? "",
        fileUri: deliverable.fileUri ?? "",
        canAddToProject: true,
      };
    default:
      // Exhaustiveness guard (S3 — the single place a kind maps to content):
      // `kind` is a closed union, so this branch is statically unreachable and
      // `satisfies never` fails to compile if a future RenderableDeliverable kind
      // is added without a case above. Chosen over the throwing `assertNever` so
      // an off-contract kind degrades to a graceful no-op (`null`) rather than
      // crashing the card click.
      deliverable.kind satisfies never;
      return null;
  }
}
