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
import { createStore, Provider } from "jotai";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  renderPreviewer,
  SIDEPANE_REGISTRY,
} from "@/features/chat/components/sidepane/registry";

// Compile-time exhaustiveness (every SidepaneKind has a previewer) is enforced by
// the mapped type on SIDEPANE_REGISTRY — a missing/extra kind fails tsgo, not a
// test. The runtime guard here only pins the key SET so a typo or stray entry is
// caught even where the type might be widened.
describe("SIDEPANE_REGISTRY", () => {
  it("maps exactly the four sidepane kinds", () => {
    expect(Object.keys(SIDEPANE_REGISTRY).sort()).toEqual([
      "file",
      "markdown",
      "sandbox",
      "webpage",
    ]);
  });

  it("maps the markdown kind to a component function", () => {
    expect(SIDEPANE_REGISTRY.markdown).toBeTypeOf("function");
  });

  it("maps the webpage kind to a component function", () => {
    expect(SIDEPANE_REGISTRY.webpage).toBeTypeOf("function");
  });

  it("maps the sandbox kind to a component function", () => {
    expect(SIDEPANE_REGISTRY.sandbox).toBeTypeOf("function");
  });

  it("maps the file kind to a component function", () => {
    expect(SIDEPANE_REGISTRY.file).toBeTypeOf("function");
  });
});

// renderPreviewer mounts a previewer, whose SidepaneHeader reads useSidepane() —
// so the render needs a jotai store (mirrors the sibling previewer tests).
function renderUnderStore(ui: ReactElement): ReturnType<typeof render> {
  return render(<Provider store={createStore()}>{ui}</Provider>);
}

it("renderPreviewer dispatches to the file previewer", () => {
  renderUnderStore(
    renderPreviewer({
      kind: "file",
      filename: "x.pdf",
      fileUrl: "https://x/x.pdf",
    }),
  );
  // The filename in the header is the stable dispatch handle (it renders for
  // every file subtype).
  expect(screen.getByText("x.pdf")).toBeInTheDocument();
});
