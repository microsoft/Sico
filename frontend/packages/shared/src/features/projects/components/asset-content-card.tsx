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

import { type JSX, type ReactNode } from "react";

export type AssetContentCardProps = {
  children: ReactNode;
};

/**
 * The asset-detail content card shared by all three detail pages — a
 * `bg-surface-basic shadow-m rounded-2xl` surface that scrolls internally. It
 * owns the card chrome only; the inner gutter is the caller's concern, because
 * markdown bodies want a wide reading gutter (`px-34`) while a file preview must
 * stay full-bleed (a PDF/image squeezed into a ~136px gutter reads as a sliver).
 */
export function AssetContentCard({
  children,
}: AssetContentCardProps): JSX.Element {
  return (
    <div className="bg-surface-basic shadow-m flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <div className="scrollbar flex flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
