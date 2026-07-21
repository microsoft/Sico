import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import {
  act,
  createElement,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { describe, expect, it } from "vitest";

import { useSidepane } from "@/features/chat/hooks/use-sidepane";

// A fresh store per test isolates the module-level sidepane atoms — without it
// `open`/`maximized` would bleed across cases (the atoms are singletons).
function wrapper(
  store: ReturnType<typeof createStore>,
): (props: PropsWithChildren) => ReactElement {
  // `.ts` test (no JSX) → build the Provider element with `createElement`.
  return function Wrapper({ children }: PropsWithChildren): ReactElement {
    return createElement(Provider, { store }, children);
  };
}

describe("useSidepane", () => {
  it("open(content) sets the content and leaves maximized false", () => {
    const store = createStore();
    const { result } = renderHook(() => useSidepane(), {
      wrapper: wrapper(store),
    });
    const content = { kind: "markdown", title: "a", markdown: "b" } as const;

    act(() => result.current.open(content));

    expect(result.current.content).toEqual(content);
    expect(result.current.maximized).toBe(false);
  });

  it("open(content) forces maximized back to false even when it was true (MP13)", () => {
    const store = createStore();
    const { result } = renderHook(() => useSidepane(), {
      wrapper: wrapper(store),
    });

    act(() => result.current.toggleMaximize());
    expect(result.current.maximized).toBe(true);

    // A second item opening must NOT inherit the prior maximize state.
    act(() => result.current.open({ kind: "webpage", url: "https://x.dev" }));
    expect(result.current.maximized).toBe(false);
  });

  it("toggleMaximize flips maximized false -> true -> false", () => {
    const store = createStore();
    const { result } = renderHook(() => useSidepane(), {
      wrapper: wrapper(store),
    });
    expect(result.current.maximized).toBe(false);

    act(() => result.current.toggleMaximize());
    expect(result.current.maximized).toBe(true);

    act(() => result.current.toggleMaximize());
    expect(result.current.maximized).toBe(false);
  });

  it("close() nulls the content and resets maximized (MI8)", () => {
    const store = createStore();
    const { result } = renderHook(() => useSidepane(), {
      wrapper: wrapper(store),
    });
    act(() =>
      result.current.open({
        kind: "file",
        filename: "x.txt",
        fileUrl: "https://x/x.txt",
      }),
    );
    act(() => result.current.toggleMaximize());
    expect(result.current.content).not.toBeNull();
    expect(result.current.maximized).toBe(true);

    act(() => result.current.close());

    expect(result.current.content).toBeNull();
    expect(result.current.maximized).toBe(false);
  });

  it("keeps open/close/toggleMaximize referentially stable across a state change", () => {
    const store = createStore();
    const { result } = renderHook(() => useSidepane(), {
      wrapper: wrapper(store),
    });
    const before = {
      open: result.current.open,
      close: result.current.close,
      toggleMaximize: result.current.toggleMaximize,
    };

    act(() => result.current.open({ kind: "sandbox", agentInstanceId: 413 }));

    // Stable callbacks let C2 cards put `open` in an effect dep array safely.
    expect(result.current.open).toBe(before.open);
    expect(result.current.close).toBe(before.close);
    expect(result.current.toggleMaximize).toBe(before.toggleMaximize);
  });
});
