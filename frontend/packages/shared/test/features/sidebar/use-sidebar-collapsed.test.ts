import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import {
  createElement,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { describe, expect, it } from "vitest";

import {
  sidebarCollapsedAtom,
  sidebarForcedCollapsedAtom,
} from "@/features/sidebar/atoms/sidebar-atom";
import { useSidebarCollapsed } from "@/features/sidebar/hooks/use-sidebar-collapsed";

// Fresh store per test isolates the module-level singleton atoms.
function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return createElement(Provider, { store }, children);
  };
}

function read(store: ReturnType<typeof createStore>): boolean {
  return renderHook(() => useSidebarCollapsed(), { wrapper: wrapper(store) })
    .result.current;
}

describe("useSidebarCollapsed", () => {
  it("is false when neither the persisted pref nor the force-collapse is set", () => {
    expect(read(createStore())).toBe(false);
  });

  it("is true when the user persisted a collapsed preference", () => {
    const store = createStore();
    store.set(sidebarCollapsedAtom, true);
    expect(read(store)).toBe(true);
  });

  it("is true while only the Sidepane force-collapse is set (persisted pref expanded)", () => {
    // Regression: a downstream menuTopExtras row (dwp Notification) must read the
    // EFFECTIVE state, so a Sidepane-forced collapse switches it to the rail
    // (icon-only) variant. Reading the persisted atom alone would leave it
    // expanded while the Sidebar itself shows the collapsed rail.
    const store = createStore();
    store.set(sidebarCollapsedAtom, false);
    store.set(sidebarForcedCollapsedAtom, true);
    expect(read(store)).toBe(true);
  });
});
