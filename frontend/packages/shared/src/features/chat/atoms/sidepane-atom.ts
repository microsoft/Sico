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

import { atom, type createStore } from "jotai";

// The data discriminant only — 4 values, no UNKNOWN. NOT a dispatch enum: the
// registry maps each kind to a previewer component, so the shell looks the kind
// up rather than switching on it (a new kind never forces a shell edit).
export type SidepaneKind = "markdown" | "webpage" | "sandbox" | "file";

// Serializable (NO JSX, NO functions) discriminated union — it is stored in a
// jotai atom, so it must round-trip as plain data (§6.E4/§8). `null` = closed.
// `sandbox`/`file` carry no payload in D1; D2/D3 add fields to these variants,
// never a new top-level kind.
export type SidepaneContent =
  | { kind: "markdown"; title: string; markdown: string }
  | { kind: "webpage"; url: string }
  // The owning agent instance id — the previewer drives the device-list poll
  // off it (`/sandbox/instance?instanceId=`). A serializable number, set when
  // the header Device button opens the sandbox (D2 fills the body from it).
  | { kind: "sandbox"; agentInstanceId: number }
  | {
      kind: "file";
      filename: string;
      fileUrl: string;
      // The blob-relative uri (wire `file.fileUri`) the "Add to project" action
      // publishes by. A serializable string; empty when the deliverable carries
      // no addressable uri (the action then stays disabled).
      fileUri?: string;
      // A DW-produced deliverable can be published to the project (the preview
      // header shows "Add to project"); a user-uploaded attachment cannot, so it
      // omits this. Serializable boolean only — the agentInstanceId comes from
      // chat context, not the payload.
      canAddToProject?: boolean;
    }
  | null;

// --- primitive atoms ---------------------------------------------------------

export const sidepaneContentAtom = atom<SidepaneContent>(null);
export const sidepaneMaximizedAtom = atom<boolean>(false);

// --- store-level action ------------------------------------------------------

// Open the sidepane on a content payload — the single definition of the open
// contract (MP13: a fresh item never inherits the prior maximize state). Both
// `useSidepane().open` (UI dispatch) and the plan-poll auto-open (a non-React
// store write) call this, so the content+maximize-reset pair can't drift apart.
export function openSidepane(
  store: ReturnType<typeof createStore>,
  content: NonNullable<SidepaneContent>,
): void {
  store.set(sidepaneContentAtom, content);
  store.set(sidepaneMaximizedAtom, false);
}
