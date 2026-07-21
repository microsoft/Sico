import { describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };

describe("@sico/shared deps", () => {
  it.each([
    "@sico/ui",
    "@tanstack/react-router",
    "axios",
    "zod",
    "jotai",
    "immer",
    "react-error-boundary",
  ])("declares runtime dep %s", (name) => {
    expect(pkg.dependencies).toHaveProperty(name);
  });
  it.each(["@storybook/react-vite", "storybook"])(
    "declares storybook dev dep %s",
    (name) => {
      expect(pkg.devDependencies).toHaveProperty(name);
    },
  );
});
