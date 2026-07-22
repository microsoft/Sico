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

import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";

import {
  type SidepaneContent,
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { Sidepane } from "@/features/chat/components/sidepane/sidepane";

// A fresh store per test isolates the module-level sidepane atoms (singletons)
// and lets us SEED `content`/`maximized` to drive the shell, then read the real
// atom back after an interaction — preferred over spying.
function renderSidepane(
  store: ReturnType<typeof createStore>,
): ReturnType<typeof render> {
  return render(
    <Provider store={store}>
      <Sidepane />
    </Provider>,
  );
}

function seedContent(
  store: ReturnType<typeof createStore>,
  content: NonNullable<SidepaneContent>,
): void {
  store.set(sidepaneContentAtom, content);
}

describe("Sidepane", () => {
  // (a) closed → the shell renders nothing so the chat sibling fills the row.
  it("renders nothing when content is null", () => {
    const store = createStore();
    renderSidepane(store);
    expect(
      screen.queryByRole("region", { name: "Preview panel" }),
    ).not.toBeInTheDocument();
  });

  // (b) markdown content → dispatched through the registry to MarkdownPreviewer.
  it("dispatches markdown content to its previewer (title shown)", () => {
    const store = createStore();
    seedContent(store, { kind: "markdown", title: "T", markdown: "# B" });
    renderSidepane(store);
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  // (c) a DIFFERENT kind → dispatched to FilePreviewer, proving registry lookup,
  // not a hardcoded markdown branch. The filename in the header is the stable
  // dispatch handle (it renders for every file subtype).
  it("dispatches file content to its previewer (filename shown)", () => {
    const store = createStore();
    seedContent(store, {
      kind: "file",
      filename: "x.pdf",
      fileUrl: "https://x/x.pdf",
    });
    renderSidepane(store);
    expect(screen.getByText("x.pdf")).toBeInTheDocument();
  });

  // (d) MI14 — Escape closes the panel by nulling the content atom.
  it("closes the sidepane on window Escape keydown (MI14)", () => {
    const store = createStore();
    seedContent(store, { kind: "markdown", title: "T", markdown: "# B" });
    renderSidepane(store);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(store.get(sidepaneContentAtom)).toBeNull();
  });

  // (e) CE3 — the scroll container is the focusable landmark.
  it("exposes a focusable Preview panel region (CE3)", () => {
    const store = createStore();
    seedContent(store, { kind: "markdown", title: "T", markdown: "# B" });
    renderSidepane(store);

    const region = screen.getByRole("region", { name: "Preview panel" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  // (f) maximized — assert a stable data attribute, not a brittle class string.
  it("reflects the maximized state via data-maximized", () => {
    const store = createStore();
    seedContent(store, { kind: "markdown", title: "T", markdown: "# B" });
    store.set(sidepaneMaximizedAtom, true);
    renderSidepane(store);

    expect(
      screen.getByRole("region", { name: "Preview panel" }),
    ).toHaveAttribute("data-maximized", "true");
  });

  // (f-cont) not maximized — the same attribute reads false in the default frame.
  it("reports data-maximized false when not maximized", () => {
    const store = createStore();
    seedContent(store, { kind: "markdown", title: "T", markdown: "# B" });
    renderSidepane(store);

    expect(
      screen.getByRole("region", { name: "Preview panel" }),
    ).toHaveAttribute("data-maximized", "false");
  });
});

// (g) ErrorBoundary: we deliberately DON'T build a forced-throw harness. The
// boundary is `react-error-boundary`'s well-tested behavior, not ours to
// re-verify; the renderPreviewer subtree mounting (cases b/c above) already
// proves the body — the ErrorBoundary's only child — renders. A bespoke
// throwing previewer would test the library, not the shell.
