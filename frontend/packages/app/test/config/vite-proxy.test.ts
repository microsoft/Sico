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

// @vitest-environment node
import type { ProxyOptions, UserConfig, UserConfigFnObject } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `defineConfig` returns object or thunk — narrow by calling the
// function form with a typed `ConfigEnv`.
async function resolveConfig(): Promise<UserConfig> {
  // Re-import so each test observes the current `process.env` —
  // vite.config reads `VITE_API_TARGET` at module evaluation time.
  vi.resetModules();
  const mod = await import("../../vite.config");
  const config = mod.default as UserConfig | UserConfigFnObject;
  if (typeof config === "function") {
    return config({ command: "serve", mode: "development" });
  }
  return config;
}

function readProxyEntry(cfg: UserConfig, route: string): ProxyOptions {
  const entry = cfg.server?.proxy?.[route];
  expect(entry).toBeDefined();
  if (typeof entry !== "object") {
    throw new Error(
      `Expected ${route} proxy entry to be a ProxyOptions object`,
    );
  }
  return entry;
}

function readProxyTarget(cfg: UserConfig, route: string): string {
  const entry = readProxyEntry(cfg, route);
  expect(entry.changeOrigin).toBe(true);
  return entry.target as string;
}

describe("vite dev proxy", () => {
  const savedTarget = process.env.VITE_API_TARGET;

  beforeEach(() => {
    delete process.env.VITE_API_TARGET;
  });

  afterEach(() => {
    if (savedTarget === undefined) {
      delete process.env.VITE_API_TARGET;
    } else {
      process.env.VITE_API_TARGET = savedTarget;
    }
  });

  it("routes /api/sico to localhost:8080 by default (microsoft/sico nginx)", async () => {
    const cfg = await resolveConfig();
    expect(readProxyTarget(cfg, "/api/sico")).toBe("http://localhost:8080");
  });

  it("routes /storage to the same target — sico backend rewrites object URLs to /storage/* via sub_filter", async () => {
    const cfg = await resolveConfig();
    expect(readProxyTarget(cfg, "/storage")).toBe("http://localhost:8080");
  });

  it("honours VITE_API_TARGET env override for both routes", async () => {
    process.env.VITE_API_TARGET = "http://localhost:8137";
    const cfg = await resolveConfig();
    expect(readProxyTarget(cfg, "/api/sico")).toBe("http://localhost:8137");
    expect(readProxyTarget(cfg, "/storage")).toBe("http://localhost:8137");
  });
});

describe("vite dev proxy — dwp backend", () => {
  const savedTarget = process.env.VITE_DWP_API_TARGET;

  beforeEach(() => {
    delete process.env.VITE_DWP_API_TARGET;
  });

  afterEach(() => {
    if (savedTarget === undefined) {
      delete process.env.VITE_DWP_API_TARGET;
    } else {
      process.env.VITE_DWP_API_TARGET = savedTarget;
    }
  });

  it("routes /api/dwp to the dwp backend by default", async () => {
    const cfg = await resolveConfig();
    expect(readProxyTarget(cfg, "/api/dwp")).toBe(
      "https://test.sico.microsoft.com",
    );
  });

  it("honours VITE_DWP_API_TARGET env override", async () => {
    process.env.VITE_DWP_API_TARGET = "http://localhost:9090";
    const cfg = await resolveConfig();
    expect(readProxyTarget(cfg, "/api/dwp")).toBe("http://localhost:9090");
  });

  it("bypasses TLS verification for the self-signed dwp host", async () => {
    const cfg = await resolveConfig();
    // dwp serves self-signed TLS, so cert verification must be off in dev.
    expect(readProxyEntry(cfg, "/api/dwp").secure).toBe(false);
  });

  it("proxies websocket upgrades for dwp chat", async () => {
    const cfg = await resolveConfig();
    expect(readProxyEntry(cfg, "/api/dwp").ws).toBe(true);
  });
});
