import { atom, type PrimitiveAtom } from "jotai";

// The per-project drawer's collapse state, KEYED BY projectId. Session-local (a
// lightweight UI preference), held in an atom rather than `useState` for two
// reasons:
//
//  1. It must SURVIVE the route remount when the user switches asset-category
//     tabs — each category is a sibling route that remounts
//     `ProjectWorkspaceContent`, which would otherwise reset a local `useState`
//     back to expanded on every tab switch.
//  2. It is PER-PROJECT: each projectId gets its OWN atom, so collapsing project
//     A's drawer doesn't also collapse project B's (a single global atom would
//     bleed the state across projects).
//
// A tiny hand-rolled registry (one atom per projectId, memoized for the session)
// rather than jotai's `atomFamily`, which is deprecated in jotai v2 / removed in
// v3. The bounded set of projects a user visits keeps the map small.
const drawerCollapsedAtoms = new Map<number, PrimitiveAtom<boolean>>();

export function projectDrawerCollapsedAtom(
  projectId: number,
): PrimitiveAtom<boolean> {
  let a = drawerCollapsedAtoms.get(projectId);
  if (!a) {
    a = atom(false);
    drawerCollapsedAtoms.set(projectId, a);
  }
  return a;
}
