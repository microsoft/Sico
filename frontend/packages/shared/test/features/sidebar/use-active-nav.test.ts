import { useLocation } from "@tanstack/react-router";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useActiveNav } from "@/features/sidebar/hooks/use-active-nav";

vi.mock("@tanstack/react-router", () => ({ useLocation: vi.fn() }));

describe("useActiveNav", () => {
  it.each([
    ["/digital-worker", { nav: "dw", agentId: null, conversationId: null }],
    ["/digital-worker/42", { nav: "dw", agentId: "42", conversationId: null }],
    [
      "/digital-worker/123/collaboration",
      { nav: "dw", agentId: "123", conversationId: null },
    ],
    [
      "/digital-worker/123/collaboration/55",
      { nav: "dw", agentId: "123", conversationId: "55" },
    ],
    ["/project", { nav: "project", agentId: null, conversationId: null }],
    [
      "/project/abc/settings",
      { nav: "project", agentId: null, conversationId: null },
    ],
    ["/profile", { nav: null, agentId: null, conversationId: null }],
    ["/", { nav: null, agentId: null, conversationId: null }],
    ["/digital-workers", { nav: null, agentId: null, conversationId: null }],
  ])("maps %s → %o", (pathname, expected) => {
    vi.mocked(useLocation).mockReturnValue({ pathname } as never);
    const { result } = renderHook(() => useActiveNav());
    expect(result.current.nav).toBe(expected.nav);
    expect(result.current.agentId).toBe(expected.agentId);
    expect(result.current.conversationId).toBe(expected.conversationId);
  });

  describe("isActive", () => {
    it.each([
      // [pathname, to, expected] — prefix match: `to` itself or descendants
      ["/project", "/project", true],
      ["/project/abc", "/project", true], // descendant matches
      ["/my-team", "/my-team", true],
      ["/my-team/x", "/my-team", true],
      ["/projects", "/project", false], // sibling prefix is not a match
      ["/other", "/my-team", false],
    ])("at %s, isActive(%s) → %s", (pathname, to, expected) => {
      vi.mocked(useLocation).mockReturnValue({ pathname } as never);
      const { result } = renderHook(() => useActiveNav());
      expect(result.current.isActive(to)).toBe(expected);
    });
  });
});
