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

import { Button } from "@sico/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MessageCirclePlus } from "lucide-react";
import { type JSX, useRef } from "react";

import { DwConversationRowsSkeleton } from "./dw-conversation-rows-skeleton";
import { useInfiniteScrollSentinel } from "../../../hooks/use-infinite-scroll-sentinel";
import { useConversations } from "../../chat/hooks/use-conversations";
import { usePendingConversationTitles } from "../../chat/hooks/use-pending-conversation-titles";
import { NAV_ROW_STATE } from "../constants";
import { useActiveNav } from "../hooks/use-active-nav";

type Props = {
  readonly agentInstanceId: number;
};

// The sidebar's "conversation mode" (Figma 20454-59481): shown in place of the
// Digital Workers list while inside a DW. A "New session" row sits above the
// DW's conversation list; clicking it starts a new session (the DW home). The
// conversation list is a SUSPENSE read — the parent
// (`ConversationModeMenu`) wraps this in a local <Suspense> (skeleton) +
// <ErrorBoundary fallback={null}>, so a slow fetch shows the skeleton and a
// failed one degrades to nothing (logged) without touching the rest of the
// sidebar. Older pages load on demand as the list scrolls to a bottom sentinel.
export function DwConversationNav({ agentInstanceId }: Props): JSX.Element {
  const { items, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversations(agentInstanceId);
  const { conversationId: activeConversationId } = useActiveNav();

  // Resolve the async-generated titles of conversations created this session.
  // Triggered by the pending-id set (written on create), not a "New Session"
  // scan — so a row that legitimately keeps that name is never polled. Each
  // resolved title is patched into its DW's list cache; each settled id is
  // dropped from the set so it never polls again, even on remount.
  usePendingConversationTitles();

  // The <ul> is the scroll container (`overflow-y-auto`), so the sentinel is
  // measured against it, not the viewport.
  const listRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  useInfiniteScrollSentinel(
    sentinelRef,
    { hasNextPage, isFetchingNextPage, fetchNextPage },
    { rootRef: listRef, fillOnComplete: true },
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {/* Section header row — clicking anywhere returns to the L1 sidebar
          (the Digital Workers list). The leading chevron signals "back". */}
      <Link
        to="/digital-worker"
        aria-label="Back to Digital Workers"
        className="group text-foreground-tertiary hover:bg-surface-muted hover:text-foreground-primary flex h-9 items-center gap-1 rounded-lg px-1"
      >
        <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate text-xs font-medium tracking-wider uppercase">
          Back
        </span>
      </Link>
      {/* New session — a secondary Button whose outer element is swapped to the
          router Link via `render` (base-ui), so the button chrome carries the
          route navigation while staying an anchor. `nativeButton={false}` tells
          base-ui the rendered element is an <a>, not a <button> (else it warns
          about lost native button semantics). The `p-2` wrapper insets it
          to align with the conversation-row text below. `shadow-none` overrides
          the secondary variant's default drop shadow — a flat, quiet affordance
          alongside the sidebar's flush nav rows. */}
      <div className="p-2">
        <Button
          variant="secondary"
          size="lg"
          className="w-full shadow-none"
          nativeButton={false}
          render={
            <Link
              to="/digital-worker/$agentId"
              params={{ agentId: String(agentInstanceId) }}
            />
          }
        >
          <MessageCirclePlus aria-hidden="true" />
          <span className="truncate">New session</span>
        </Button>
      </div>

      {/* Conversation list (Figma 20454:59519): rows 32px tall with 4px gap
          between them, one truncated title per row. The left inset comes from
          the shared nav container's p-2 — no extra pl here. The <ul> + sentinel
          are ALWAYS mounted (even empty): the IntersectionObserver effect runs
          once and early-returns on a null ref, so a sentinel that only appeared
          after the first conversation arrived would never be observed — dead
          pagination on the empty→non-empty (create-first) transition. */}
      <ul
        ref={listRef}
        className="scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
      >
        {items.length === 0 ? (
          <li className="text-foreground-tertiary px-2 py-1.5 text-sm">
            No conversations yet
          </li>
        ) : (
          items.map((conversation) => {
            const isActive = activeConversationId === String(conversation.id);
            return (
              <li key={conversation.id}>
                <Link
                  to="/digital-worker/$agentId/collaboration/$conversationId"
                  params={{
                    agentId: String(agentInstanceId),
                    conversationId: String(conversation.id),
                  }}
                  aria-current={isActive ? "page" : undefined}
                  data-active={isActive ? true : undefined}
                  className={`${NAV_ROW_STATE} flex h-8 min-w-0 items-center rounded-lg px-2 text-sm`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {conversation.title || "Untitled"}
                  </span>
                </Link>
              </li>
            );
          })
        )}
        {/* Loading-more rows: a batch of skeleton rows (shared with the first-
            load skeleton so they can't drift), shown at the bottom while the
            next page fetches. Wrapped in a testid-carrying <li> for querying. */}
        {isFetchingNextPage && (
          <li data-testid="conversation-loading-more">
            <DwConversationRowsSkeleton />
          </li>
        )}
        {/* Bottom sentinel: scrolling it into the list's 200px prefetch band
            pulls the next page. Mounted unconditionally (see the list comment)
            — the hook's own `hasNextPage` guard makes it a no-op when nothing's
            left. */}
        <li
          ref={sentinelRef}
          data-testid="conversation-list-sentinel"
          aria-hidden="true"
        />
      </ul>
    </div>
  );
}
