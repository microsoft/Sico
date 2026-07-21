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
