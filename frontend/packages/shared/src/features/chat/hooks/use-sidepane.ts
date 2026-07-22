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

import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback } from "react";

import {
  openSidepane,
  type SidepaneContent,
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "../atoms/sidepane-atom";

export type SidepaneActions = {
  open: (content: NonNullable<SidepaneContent>) => void;
  close: () => void;
  toggleMaximize: () => void;
};

export type UseSidepane = SidepaneActions & {
  content: SidepaneContent;
  maximized: boolean;
};

// Write-only surface (design S5: state, not a `drawerRef.current.open(...)`
// ref). Producers (deliverable chips/tiles) that only DISPATCH must use this
// instead of `useSidepane`: `useSetAtom` subscribes to no atom read, so they
// never re-render on an open/close/maximize they don't display.
export function useSidepaneActions(): SidepaneActions {
  const store = useStore();
  const setContent = useSetAtom(sidepaneContentAtom);
  const setMaximized = useSetAtom(sidepaneMaximizedAtom);

  // Delegates to the store-level `openSidepane` (MP13: clears `maximized` so a
  // fresh item never inherits the prior previewer's maximize state) — the same
  // helper the plan-poll auto-open calls, so the two open paths can't drift.
  const open = useCallback(
    (next: NonNullable<SidepaneContent>) => {
      openSidepane(store, next);
    },
    [store],
  );

  // MI8: nulling the content structurally clears the payload; reset the frame.
  const close = useCallback(() => {
    setContent(null);
    setMaximized(false);
  }, [setContent, setMaximized]);

  // Functional updater reads the live value (.claude/rules/react.md).
  const toggleMaximize = useCallback(
    () => setMaximized((prev) => !prev),
    [setMaximized],
  );

  return { open, close, toggleMaximize };
}

// The full read+write surface — the shell/header read `content`/`maximized` and
// call `close`/`toggle`, so they legitimately subscribe to both atoms. Producers
// that only call `open` should use `useSidepaneActions` to skip the read sub.
export function useSidepane(): UseSidepane {
  const content = useAtomValue(sidepaneContentAtom);
  const maximized = useAtomValue(sidepaneMaximizedAtom);
  const actions = useSidepaneActions();

  return { content, maximized, ...actions };
}
