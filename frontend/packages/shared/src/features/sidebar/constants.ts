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

// Max agents previewed under the DW group in both expanded and collapsed modes.
// Also reused as the pending-skeleton row count in both modes so the placeholder
// density matches the steady-state row cap exactly — zero layout shift on
// data arrival.
export const DW_PREVIEW = 5;

// The interactive nav-row color palette (rest / hover / active), shared by every
// full-width text nav row — NavRow, DwList's agent rows, and the DW conversation
// rows. Extracted so a token change lands in ONE place: this exact fragment was
// hand-inlined in four files and had to be re-tokenized in lockstep, which lint
// can't police (a missed copy = silent visual drift). Layout classes (height,
// gap, padding) stay per-row since they differ (h-9 vs h-8). The icon-only rail
// rows use a deliberate subset (no foreground shifts) and don't compose this.
export const NAV_ROW_STATE =
  "text-foreground-secondary hover:bg-surface-muted hover:text-foreground-primary data-[active]:bg-surface-muted data-[active]:text-foreground-emphasis";
