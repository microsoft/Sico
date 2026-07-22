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

import { Popover, PopoverContent, PopoverTrigger } from "@sico/ui";
import type { JSX, ReactNode } from "react";

import { AgentInfoPopover } from "./agent-info-popover";
import { DwAvatar } from "../../../components/dw-avatar";
import { useAgentSuspenseQuery } from "../hooks/use-agents-query";

/**
 * Collaboration page header — agent metadata (not chat): the agent's avatar +
 * name + role as a button that opens an info popover (project / operator).
 * Reads the agent via `useAgentSuspenseQuery` so a deep-link / refresh resolves
 * under the route's Suspense boundary. `actions` (right-aligned) lets the route
 * mount page-level controls — e.g. the chat Device button — on the same row
 * without this feature depending on chat.
 */
export function Header({
  agentId,
  actions,
}: {
  agentId: number;
  actions?: ReactNode;
}): JSX.Element {
  const { data: agent } = useAgentSuspenseQuery(agentId);

  return (
    <header className="flex h-12 items-center justify-between gap-0.5 px-5">
      <div className="flex min-w-0 items-center gap-0.5">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Agent details"
                className="hover:bg-button-subtle-fill-hover flex max-w-72 min-w-0 items-center gap-2 rounded-md px-1 py-0.5"
              />
            }
          >
            <DwAvatar agent={agent} size="xs" decorative />
            <div className="leading-body-2 text-foreground-primary min-w-0 truncate text-base font-medium">
              <span>{agent.name}</span>
              {agent.role ? <span>{`, ${agent.role}`}</span> : null}
            </div>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-75 p-0">
            <AgentInfoPopover agent={agent} />
          </PopoverContent>
        </Popover>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center">{actions}</div>
      ) : null}
    </header>
  );
}
