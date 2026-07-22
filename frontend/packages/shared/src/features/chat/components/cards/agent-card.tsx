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

import { Markdown } from "../../../../components/markdown";
import { useSmoothText } from "../../hooks/use-smooth-text";

export type AgentCardProps = {
  text: string;
  // Still receiving frames; forwarded to <Markdown> so it re-parses only the
  // live tail, not the whole body each frame.
  streaming?: boolean;
};

// Unframed, left-aligned Markdown body — no bubble, unlike UserCard. Block flow
// (not flex-col) so child blocks' own my-2/first:mt-0 spacing applies. While
// streaming, the text is revealed with a typewriter smoothing pass so the
// network-chunked frames type in steadily instead of jumping in bursts.
export function AgentCard({ text, streaming }: AgentCardProps): JSX.Element {
  const smoothed = useSmoothText(text, streaming ?? false);
  return (
    // `min-w-0 wrap-anywhere`: a long unbreakable token (e.g. a `file:///…`
    // artifact path with no spaces) must not push this flex column past its
    // `max-w` — `wrap-anywhere` lets it break mid-token so the message stays
    // within the column instead of overflowing to the right.
    <div className="text-foreground-primary min-w-0 text-base wrap-anywhere">
      <Markdown content={smoothed} streaming={streaming} />
    </div>
  );
}
