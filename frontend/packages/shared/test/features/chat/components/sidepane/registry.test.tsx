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
