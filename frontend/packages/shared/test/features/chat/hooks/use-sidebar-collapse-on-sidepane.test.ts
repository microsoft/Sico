import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { describe, expect, it } from "vitest";

import {
  type SidepaneContent,
  sidepaneContentAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { useSidebarCollapseOnSidepane } from "@/features/chat/hooks/use-sidebar-collapse-on-sidepane";
import {
  sidebarCollapsedAtom,
  sidebarEffectiveCollapsedAtom,
  sidebarForcedCollapsedAtom,
} from "@/features/sidebar/atoms/sidebar-atom";

const MARKDOWN: SidepaneContent = {
  kind: "markdown",
  title: "A",
  markdown: "# a",
};
const FILE: SidepaneContent = {
  kind: "file",
  filename: "x.txt",
  fileUrl: "https://x/x.txt",
};

// Fresh store per test isolates the module-level singleton atoms.
function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return createElement(Provider, { store }, children);
  };
}

function mount(store: ReturnType<typeof createStore>): void {
  renderHook(() => useSidebarCollapseOnSidepane(), { wrapper: wrapper(store) });
}

describe("useSidebarCollapseOnSidepane", () => {
  it("force-collapses the sidebar when the sidepane opens", () => {
    const store = createStore();
    mount(store);

    act(() => store.set(sidepaneContentAtom, MARKDOWN));

    expect(store.get(sidebarEffectiveCollapsedAtom)).toBe(true);
  });

  it("clears the force-collapse when the sidepane closes", () => {
    const store = createStore();
    mount(store);

    act(() => store.set(sidepaneContentAtom, MARKDOWN));
    act(() => store.set(sidepaneContentAtom, null));

    expect(store.get(sidebarForcedCollapsedAtom)).toBe(false);
  });

  it("never writes the persisted preference (reload-safe)", () => {
    const store = createStore();
    // User prefers the sidebar EXPANDED.
    store.set(sidebarCollapsedAtom, false);
    mount(store);

    act(() => store.set(sidepaneContentAtom, MARKDOWN));

    // Open force-collapses the DISPLAY but must leave the persisted pref intact,
    // so a reload-with-pane-open can't strand it as collapsed.
    expect(store.get(sidebarEffectiveCollapsedAtom)).toBe(true);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });

  it("restores an expanded sidebar after the sidepane closes", () => {
    const store = createStore();
    store.set(sidebarCollapsedAtom, false);
    mount(store);

    act(() => store.set(sidepaneContentAtom, MARKDOWN));
    act(() => store.set(sidepaneContentAtom, null));

    expect(store.get(sidebarEffectiveCollapsedAtom)).toBe(false);
  });

  it("keeps a pre-collapsed sidebar collapsed after the sidepane closes", () => {
    const store = createStore();
    store.set(sidebarCollapsedAtom, true);
    mount(store);

    act(() => store.set(sidepaneContentAtom, MARKDOWN));
    act(() => store.set(sidepaneContentAtom, null));

    expect(store.get(sidebarEffectiveCollapsedAtom)).toBe(true);
  });

  it("stays force-collapsed across a content swap (markdown→file)", () => {
    const store = createStore();
    store.set(sidebarCollapsedAtom, false);
    mount(store);

    act(() => store.set(sidepaneContentAtom, MARKDOWN));
    act(() => store.set(sidepaneContentAtom, FILE));

    // The swap leaves isOpen true → still force-collapsed, pref untouched.
    expect(store.get(sidebarEffectiveCollapsedAtom)).toBe(true);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
  });
});
