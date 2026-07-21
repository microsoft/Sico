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
