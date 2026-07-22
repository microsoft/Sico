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

import { describe, expect, it } from "vitest";

import { loginFormSchema } from "@/features/rbac-login/schemas/login-form";

describe("loginFormSchema", () => {
  it("trims and accepts a valid email", () => {
    const result = loginFormSchema.safeParse({
      email: "  user@sico.local  ",
      password: "secret123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@sico.local");
    }
  });

  it("rejects email shorter than 3 chars (backend binding min)", () => {
    expect(
      loginFormSchema.safeParse({ email: "a@", password: "secret123" }).success,
    ).toBe(false);
  });

  it("rejects email longer than 64 chars (backend binding max)", () => {
    const long = `${"x".repeat(60)}@b.co`;
    expect(
      loginFormSchema.safeParse({ email: long, password: "secret123" }).success,
    ).toBe(false);
  });

  it("rejects password shorter than 6", () => {
    expect(
      loginFormSchema.safeParse({ email: "u@b.co", password: "12345" }).success,
    ).toBe(false);
  });

  it("does NOT trim password (leading/trailing space may be the secret)", () => {
    const result = loginFormSchema.safeParse({
      email: "u@b.co",
      password: " secret ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.password).toBe(" secret ");
    }
  });
});
