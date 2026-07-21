import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { Route } from "../../../src/routes/_authed/project.$projectId";

// Shared guard for all `$projectId` children (overview · asset-detail ·
// knowledge-tags). A malformed deep link (non-numeric or non-positive
// projectId) must surface the app's 404 boundary — not the router default
// error UI with a raw ZodError message. `beforeLoad` calls `safeParse` and
// throws `notFound()` so the missing-route copy renders consistently.
// (`parseParams` errors route to `errorComponent`, not the 404 boundary,
// which is why the guard lives in `beforeLoad`.)
describe("/_authed/project/$projectId beforeLoad", () => {
  type BeforeLoadShape = {
    beforeLoad: (ctx: { params: { projectId: string } }) => unknown;
  };
  const opts = Route.options as Partial<BeforeLoadShape> as BeforeLoadShape;

  it("throws notFound() for non-numeric projectId", () => {
    try {
      opts.beforeLoad({ params: { projectId: "abc" } });
      throw new Error("expected notFound()");
    } catch (err) {
      expect(isNotFound(err)).toBe(true);
    }
  });

  it("throws notFound() for negative projectId", () => {
    try {
      opts.beforeLoad({ params: { projectId: "-1" } });
      throw new Error("expected notFound()");
    } catch (err) {
      expect(isNotFound(err)).toBe(true);
    }
  });

  it("returns undefined for a valid positive numeric projectId", () => {
    expect(opts.beforeLoad({ params: { projectId: "42" } })).toBeUndefined();
  });

  it("renders a component (the layout <Outlet/> host)", () => {
    expect(Route.options.component).toBeDefined();
  });
});
