import { describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };

describe("@sico/app runtime deps", () => {
  const required = [
    "@tanstack/react-router",
    "@tanstack/react-query",
    "axios",
    "zod",
    "jotai",
    "immer",
    "react-error-boundary",
  ];
  it.each(required)("declares %s", (name) => {
    expect(pkg.dependencies).toHaveProperty(name);
  });
});
