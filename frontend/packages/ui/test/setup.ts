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

Object.defineProperty(global, "ResizeObserver", {
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

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  cleanup();
});
