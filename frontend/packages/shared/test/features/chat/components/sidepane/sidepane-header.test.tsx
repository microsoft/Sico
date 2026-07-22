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

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { FileText } from "lucide-react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  sidepaneContentAtom,
  sidepaneMaximizedAtom,
} from "@/features/chat/atoms/sidepane-atom";
import { SidepaneHeader } from "@/features/chat/components/sidepane/sidepane-header";

// A fresh store per test isolates the module-level sidepane atoms (they are
// singletons) and lets us drive `maximized`/`content` directly, then read the
// real atom state back after an interaction — preferred over spying.
function renderHeader(
  ui: ReactElement,
  store: ReturnType<typeof createStore>,
): ReturnType<typeof render> {
  return render(<Provider store={store}>{ui}</Provider>);
}

describe("SidepaneHeader", () => {
  it("renders the title text", () => {
    const store = createStore();
    renderHeader(<SidepaneHeader icon={FileText} title="My Report" />, store);
    expect(screen.getByText("My Report")).toBeInTheDocument();
  });

  it("renders the file-type icon passed via the icon prop", () => {
    const store = createStore();
    renderHeader(<SidepaneHeader icon={FileText} title="My Report" />, store);
    expect(screen.getByTestId("sidepane-header-icon")).toBeInTheDocument();
  });

  it("labels the maximize button 'Maximize' when not maximized", () => {
    const store = createStore();
    renderHeader(<SidepaneHeader icon={FileText} title="x" />, store);
    expect(
      screen.getByRole("button", { name: "Maximize" }),
    ).toBeInTheDocument();
  });

  it("toggles maximize on click, flipping sidepaneMaximizedAtom to true", async () => {
    const user = userEvent.setup();
    const store = createStore();
    renderHeader(<SidepaneHeader icon={FileText} title="x" />, store);

    await user.click(screen.getByRole("button", { name: "Maximize" }));

    expect(store.get(sidepaneMaximizedAtom)).toBe(true);
  });

  it("labels the button 'Restore' (not 'Maximize') when maximized", () => {
    const store = createStore();
    store.set(sidepaneMaximizedAtom, true);
    renderHeader(<SidepaneHeader icon={FileText} title="x" />, store);

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Maximize" }),
    ).not.toBeInTheDocument();
  });

  it("labels the close button 'Close'", () => {
    const store = createStore();
    renderHeader(<SidepaneHeader icon={FileText} title="x" />, store);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closes the sidepane on click, nulling sidepaneContentAtom", async () => {
    const user = userEvent.setup();
    const store = createStore();
    store.set(sidepaneContentAtom, {
      kind: "markdown",
      title: "x",
      markdown: "y",
    });
    renderHeader(<SidepaneHeader icon={FileText} title="x" />, store);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(store.get(sidepaneContentAtom)).toBeNull();
  });

  it("renders titleSlot, actionsSlot, and statusSlot children when passed", () => {
    const store = createStore();
    renderHeader(
      <SidepaneHeader
        icon={FileText}
        title="x"
        titleSlot={<span>TITLE_SLOT</span>}
        actionsSlot={<span>ACTIONS_SLOT</span>}
        statusSlot={<span>STATUS_SLOT</span>}
      />,
      store,
    );

    expect(screen.getByText("TITLE_SLOT")).toBeInTheDocument();
    expect(screen.getByText("ACTIONS_SLOT")).toBeInTheDocument();
    expect(screen.getByText("STATUS_SLOT")).toBeInTheDocument();
  });
});
