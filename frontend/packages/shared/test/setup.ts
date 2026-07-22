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

// This import has the side effect of adding custom expectations.
// Docs at https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// A real class, not `vi.fn().mockImplementation(...)`: a spy-backed mock loses
// its implementation under a test's `vi.restoreAllMocks()`, after which
// `new ResizeObserver().observe` is undefined — which crashes floating-ui the
// moment any Base UI popup (tooltip/dropdown) opens in a later test in the same
// worker. A plain class survives restore/reset untouched.
Object.defineProperty(global, "ResizeObserver", {
  writable: true,
  value: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
});

// jsdom lacks rAF; back it with a timer so rAF-batched appends run in tests.
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
    setTimeout(
      () => cb(performance.now()),
      0,
    ) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number): void =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
}

// jsdom lacks object-URL APIs; back them so image-preview components can
// createObjectURL/revokeObjectURL without throwing in tests.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
}

// jsdom doesn't implement Element.scrollTo; components that auto-scroll a
// container (the message list via use-stick-to-bottom) call it on mount.
// Stub it as a no-op so the call is inert rather than a TypeError in tests.
// `typeof` reads the runtime value (jsdom leaves it undefined) — a truthiness
// check would be type-narrowed away, since the lib type marks it always present.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollTo !== "function"
) {
  Element.prototype.scrollTo =
    vi.fn() as unknown as typeof Element.prototype.scrollTo;
}

// jsdom has no canvas 2D context; `lottie-web` (pulled in eagerly by Spinner)
// touches `getContext("2d")` at import time and crashes on the null. Stub the
// methods it reaches for so the import is inert in tests. Guarded for the
// node-environment suites where `HTMLCanvasElement` is undefined.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    fillStyle: "",
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// jsdom lacks `DOMMatrix`; `pdfjs-dist` (pulled in eagerly by the file-explorer
// PdfPreview, which sits in the skill card details tree) constructs one at
// import time and crashes on the missing global. A no-op stub keeps the import
// inert for the many skill suites that import the barrel but never render a PDF.
if (typeof globalThis.DOMMatrix === "undefined") {
  Object.defineProperty(globalThis, "DOMMatrix", {
    writable: true,
    value: class {},
  });
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  cleanup();
  // eslint-disable-next-line no-restricted-syntax -- test teardown clears storage between cases
  localStorage.clear();
});
