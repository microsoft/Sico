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

import { type JSX } from "react";

import { MarkdownBlock } from "./markdown-block";
import { splitStablePrefix } from "../../utils/split-stable-prefix";

export type MarkdownProps = {
  content: string;
  // Opt-in incremental render for a growing turn (§6.E7c): split into a settled
  // prefix + live tail so only the tail re-parses each frame.
  streaming?: boolean;
};

// XSS-safe Markdown boundary: react-markdown + remark-gfm with **no rehype-raw**,
// so raw HTML surfaces as escaped text, not live nodes (§6.E6).
//
// Both modes render the SAME two-block Fragment (non-streaming = whole body in
// the prefix, empty tail), so toggling `streaming` on a live instance never
// swaps the element type here — which would remount the subtree (re-highlight,
// dropped `<details open>`, scroll jump).
export function Markdown({ content, streaming }: MarkdownProps): JSX.Element {
  const at = streaming ? splitStablePrefix(content) : content.length;
  return (
    <>
      <MarkdownBlock content={content.slice(0, at)} />
      <MarkdownBlock content={content.slice(at)} />
    </>
  );
}
