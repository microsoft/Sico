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

// Async data state for a select field — drives loading / error / empty
// affordances so a slow or failed fetch isn't a silently blank dropdown.
export type LoadState = "loading" | "error" | "empty" | "ready";

// Collapse a react-query result (pending/error + item count) into a single
// LoadState the Add DW select fields render from.
export function deriveState(
  isPending: boolean,
  isError: boolean,
  count: number,
): LoadState {
  if (isPending) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  return count === 0 ? "empty" : "ready";
}

// Trigger placeholder for a select, varying by load state.
export function placeholderFor(
  state: LoadState,
  ready: string,
  noun: string,
): string {
  if (state === "loading") {
    return `Loading ${noun}…`;
  }
  if (state === "error") {
    return `Couldn't load ${noun}`;
  }
  return ready;
}
