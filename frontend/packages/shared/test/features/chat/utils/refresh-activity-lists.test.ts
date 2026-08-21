import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { ConversationSummary } from "@/features/chat/schemas/conversation";
import { refreshActivityListsAfterSettle } from "@/features/chat/utils/refresh-activity-lists";

function conv(id: number): ConversationSummary {
  return { id, title: `C${id}`, createdAt: id, agentInstanceId: 7 };
}

describe("refreshActivityListsAfterSettle", () => {
  const CONV_KEY = ["conversations", "list", { agentInstanceId: 7 }];
  const AGENTS_KEY = ["agents", "list"];

  function seed(client: QueryClient, topId: number): void {
    client.setQueryData(CONV_KEY, {
      pages: [{ items: [conv(topId), conv(999)], hasNext: false }],
      pageParams: [1],
    });
  }

  it("refetches the conversation list when the conversation is not at the top", () => {
    const client = new QueryClient();
    seed(client, 42);
    const spy = vi.spyOn(client, "invalidateQueries");
    refreshActivityListsAfterSettle(client, 7, 5);
    expect(spy).toHaveBeenCalledWith({ queryKey: CONV_KEY });
  });

  it("skips the conversation-list refetch when it is already at the top", () => {
    const client = new QueryClient();
    seed(client, 5);
    const spy = vi.spyOn(client, "invalidateQueries");
    refreshActivityListsAfterSettle(client, 7, 5);
    expect(spy).not.toHaveBeenCalledWith({ queryKey: CONV_KEY });
  });

  it("skips the conversation-list refetch when conversationId is undefined (create-first)", () => {
    const client = new QueryClient();
    seed(client, 42);
    const spy = vi.spyOn(client, "invalidateQueries");
    refreshActivityListsAfterSettle(client, 7, undefined);
    expect(spy).not.toHaveBeenCalledWith({ queryKey: CONV_KEY });
  });

  it("invalidates the DW list when the DW isn't at the head of any cached list", () => {
    // No agents cache seeded → `bumpAgentToTop` can't confirm the DW is already
    // first, so it invalidates the prefix to let the mounted observers refetch.
    const client = new QueryClient();
    seed(client, 5);
    const spy = vi.spyOn(client, "invalidateQueries");
    refreshActivityListsAfterSettle(client, 7, 5);
    expect(spy).toHaveBeenCalledWith({ queryKey: AGENTS_KEY });
  });

  it("skips the DW-list refetch when the DW is already at the head", () => {
    // A cached agents list already shows DW 7 first → no reorder needed.
    const client = new QueryClient();
    seed(client, 5);
    client.setQueryData(
      [
        "agents",
        "list",
        { isEmployer: false, pageSize: 30, showInactive: false },
      ],
      {
        pages: [{ items: [{ id: 7 }], total: 1, hasNext: false }],
        pageParams: [1],
      },
    );
    const spy = vi.spyOn(client, "invalidateQueries");
    refreshActivityListsAfterSettle(client, 7, 5);
    expect(spy).not.toHaveBeenCalledWith({ queryKey: AGENTS_KEY });
  });
});
