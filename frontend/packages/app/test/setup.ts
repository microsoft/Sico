// This import has the side effect of adding custom expectations.
// Docs at https://github.com/testing-library/jest-dom
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

if (typeof window !== "undefined") {
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
}

Object.defineProperty(global, "ResizeObserver", {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

// jsdom has no IntersectionObserver; MessageList mounts an infinite-scroll
// sentinel that constructs one on mount. It renders in any chat route test now
// that a history-fetch failure no longer suspends the panel away (it toasts
// in-place), so the observer must exist globally, not per-suite.
Object.defineProperty(global, "IntersectionObserver", {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

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
// PdfPreview, which sits in the studio route tree) constructs one at import
// time and crashes on the missing global. A no-op stub keeps the import inert
// for route/integration tests that never actually render a PDF.
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
});
