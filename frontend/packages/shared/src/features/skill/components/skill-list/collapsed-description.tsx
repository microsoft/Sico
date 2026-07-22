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

import type { ReactElement } from "react";

// Collapsed preview of the skill description: a masked, clamped block that
// expands the card on click (legacy StyledExpandSection collapsed region).
export function CollapsedDescription({
  description,
  onExpand,
}: {
  description: string;
  onExpand: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="block w-full pt-2 text-left"
    >
      <span
        className="leading-body text-foreground-emphasis block"
        style={{
          maxHeight: "4.2em",
          overflow: "hidden",
          maskImage: "linear-gradient(to bottom, #000 45%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, #000 45%, transparent 100%)",
        }}
      >
        {description}
      </span>
    </button>
  );
}
