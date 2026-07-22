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

import { Skeleton } from "@sico/ui";
import { Link } from "@tanstack/react-router";
import { type JSX, type ReactNode } from "react";

import { DwAvatar } from "../../../components/dw-avatar";
import { DW_PREVIEW, NAV_ROW_STATE } from "../constants";
import { useActiveNav } from "../hooks/use-active-nav";
import { type AgentLite, useDwPreview } from "../hooks/use-dw-preview";

export function DwList(): JSX.Element {
  const preview = useDwPreview();
  const { nav, agentId } = useActiveNav();

  let body: ReactNode;
  if (preview.status === "error") {
    body = (
      <p
        data-testid="sidebar-dw-error-boundary"
        className="text-foreground-tertiary px-2 py-1.5 text-sm"
      >
        Couldn&apos;t load agents
      </p>
    );
  } else if (preview.status === "pending") {
    body = (
      <ul
        aria-busy="true"
        aria-label="Loading agents"
        className="flex flex-col gap-1"
      >
        {Array.from({ length: DW_PREVIEW }, (_, index) => (
          <li
            // eslint-disable-next-line react/no-array-index-key -- static placeholder count
            key={index}
            data-testid="dw-skeleton-row"
            className="flex h-9 items-center gap-2 px-2"
          >
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <Skeleton className="h-3 flex-1" />
          </li>
        ))}
      </ul>
    );
  } else if (preview.items.length === 0) {
    body = (
      <p className="text-foreground-tertiary px-2 py-1.5 text-sm">
        No agents yet
      </p>
    );
  } else {
    const items: readonly AgentLite[] = preview.items;
    body = (
      <ul className="flex flex-col gap-1">
        {items.map((agent) => {
          const isActive = nav === "dw" && agentId === String(agent.id);
          return (
            <li key={agent.id}>
              <Link
                to="/digital-worker/$agentId"
                params={{ agentId: String(agent.id) }}
                aria-current={isActive ? "page" : undefined}
                data-active={isActive ? true : undefined}
                className={`${NAV_ROW_STATE} flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium`}
              >
                <DwAvatar agent={agent} size="xs" decorative />
                <span className="truncate">
                  {agent.role ? `${agent.name}, ${agent.role}` : agent.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div
      role="group"
      aria-label="Digital Workers list"
      data-testid="dw-list-container"
      className="w-full min-w-0"
    >
      {body}
    </div>
  );
}
