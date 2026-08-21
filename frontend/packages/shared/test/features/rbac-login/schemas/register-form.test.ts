import { describe, expect, it } from "vitest";

import { registerFormSchema } from "@/features/rbac-login/schemas/register-form";

describe("registerFormSchema", () => {
  it("accepts a standard email domain and an 8-character password", () => {
    expect(
      registerFormSchema.parse({
        email: "  person@example.com ",
        password: "12345678",
      }),
    ).toEqual({
      email: "person@example.com",
      password: "12345678",
    });
  });

  it("rejects invalid email and passwords shorter than 8 characters", () => {
    expect(() =>
      registerFormSchema.parse({
        email: "invalid",
        password: "12345678",
      }),
    ).toThrow();
    expect(() =>
      registerFormSchema.parse({
        email: "person@example.com",
        password: "1234567",
      }),
    ).toThrow();
  });

  it("enforces email and password maximum lengths without trimming password", () => {
    expect(() =>
      registerFormSchema.parse({
        email: `${"a".repeat(53)}@example.com`,
        password: "12345678",
      }),
    ).toThrow();
    expect(() =>
      registerFormSchema.parse({
        email: "person@example.com",
        password: "x".repeat(129),
      }),
    ).toThrow();
    expect(
      registerFormSchema.parse({
        email: "person@example.com",
        password: "  secret  ",
      }).password,
    ).toBe("  secret  ");
  });
});
