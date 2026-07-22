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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AUTH_EXPIRES_AT_LS,
  AUTH_TOKEN_LS,
  AUTH_USER_LS,
  getItemFromLocalStorage,
  type LocalStorageKey,
  removeItemFromLocalStorage,
  safeGetItemFromLocalStorage,
  safeSetItemToLocalStorage,
  setItemToLocalStorage,
} from "@/utils/local-storage";
import { logger } from "@/utils/logger";

// Tests for the generic LocalStorage wrapper. Uses `AUTH_TOKEN_LS` for
// the runtime assertions because the type-level whitelist
// (`LocalStorageKey`) only admits registered keys; this stays in
// lockstep with the production allowlist instead of fabricating a
// side-channel test-only key.
const KEY: LocalStorageKey = AUTH_TOKEN_LS;

const sampleSchema = z.object({
  id: z.string(),
  count: z.number(),
});

beforeEach(() => {
  // Each test starts from a clean LS slice; we touch only the registered
  // auth keys so the suite never collides with other test files.
  removeItemFromLocalStorage(AUTH_TOKEN_LS);
  removeItemFromLocalStorage(AUTH_USER_LS);
  removeItemFromLocalStorage(AUTH_EXPIRES_AT_LS);
});

describe("local-storage primitives", () => {
  it("setItemToLocalStorage + getItemFromLocalStorage round-trip a string", () => {
    setItemToLocalStorage(KEY, "hello");
    expect(getItemFromLocalStorage(KEY)).toBe("hello");
  });

  it("getItemFromLocalStorage returns null when key is absent", () => {
    expect(getItemFromLocalStorage(KEY)).toBeNull();
  });

  it("removeItemFromLocalStorage clears a previously-set value", () => {
    setItemToLocalStorage(KEY, "x");
    removeItemFromLocalStorage(KEY);
    expect(getItemFromLocalStorage(KEY)).toBeNull();
  });
});

describe("safeGetItemFromLocalStorage", () => {
  it("returns null and does not log when the key is absent", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    expect(safeGetItemFromLocalStorage(KEY, sampleSchema)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns the parsed value when JSON + schema both succeed", () => {
    setItemToLocalStorage(KEY, JSON.stringify({ id: "u1", count: 7 }));
    expect(safeGetItemFromLocalStorage(KEY, sampleSchema)).toEqual({
      id: "u1",
      count: 7,
    });
  });

  it("returns null and logs on malformed JSON", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    setItemToLocalStorage(KEY, "{not-json");
    expect(safeGetItemFromLocalStorage(KEY, sampleSchema)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/JSON\.parse failed/);
  });

  it("returns null and logs on schema mismatch", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    setItemToLocalStorage(KEY, JSON.stringify({ id: "u1", count: "nope" }));
    expect(safeGetItemFromLocalStorage(KEY, sampleSchema)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/schema validation failed/);
  });
});

describe("safeSetItemToLocalStorage", () => {
  it("serialises and writes when the value matches the schema", () => {
    safeSetItemToLocalStorage(KEY, sampleSchema, { id: "u1", count: 3 });
    expect(getItemFromLocalStorage(KEY)).toBe(
      JSON.stringify({ id: "u1", count: 3 }),
    );
  });

  it("refuses to write and logs when the value fails the schema", () => {
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    // @ts-expect-error -- intentionally violating the schema to assert the runtime guard
    safeSetItemToLocalStorage(KEY, sampleSchema, { id: 1, count: "x" });
    expect(getItemFromLocalStorage(KEY)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toMatch(/refused to write/);
  });
});
