import { useLocation } from "@tanstack/react-router";
import { useMemo } from "react";

export type ActiveNav = "dw" | "project" | null;

export type ActiveNavState = {
  readonly nav: ActiveNav;
  readonly agentId: string | null;
  // The active conversation id when the URL is
  // `/digital-worker/$agentId/collaboration/$conversationId` — drives the
  // sidebar conversation-list highlight. Null on the home/index or any
  // non-conversation path.
  readonly conversationId: string | null;
  // Path-match predicate for downstream extra nav rows: matches `to` itself
  // or any descendant (`/my-team`, `/my-team/...`). Built-in DW/Projects
  // highlight is derived from `nav`/`agentId` directly, not this.
  readonly isActive: (to: string) => boolean;
};

export function useActiveNav(): ActiveNavState {
  const { pathname } = useLocation();
  return useMemo<ActiveNavState>(() => {
    const isActive = (to: string): boolean =>
      pathname === to || pathname.startsWith(`${to}/`);
    if (pathname === "/digital-worker") {
      return { nav: "dw", agentId: null, conversationId: null, isActive };
    }
    if (pathname.startsWith("/digital-worker/")) {
      const rest = pathname.slice("/digital-worker/".length);
      const segments = rest.split("/");
      const agentId = segments[0] ?? "";
      // `.../collaboration/$conversationId` → segments = [agentId,
      // "collaboration", conversationId]. Read the id only when the middle
      // segment is `collaboration`, so a future sibling route can't be mistaken
      // for a conversation. A missing/empty segment collapses to null.
      const conversationSegment =
        segments[1] === "collaboration" ? (segments[2] ?? "") : "";
      return {
        nav: "dw",
        agentId: agentId || null,
        conversationId: conversationSegment || null,
        isActive,
      };
    }
    if (pathname === "/project" || pathname.startsWith("/project/")) {
      return { nav: "project", agentId: null, conversationId: null, isActive };
    }
    return { nav: null, agentId: null, conversationId: null, isActive };
  }, [pathname]);
}
