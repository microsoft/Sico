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

import { Skeleton, Tooltip, TooltipContent, TooltipTrigger } from "@sico/ui";
import { Link } from "@tanstack/react-router";
import { type JSX } from "react";

import { DwAvatar } from "../../../components/dw-avatar";
import { DW_PREVIEW } from "../constants";
import { useActiveNav } from "../hooks/use-active-nav";
import { useDwPreview } from "../hooks/use-dw-preview";

export function RailDwList(): JSX.Element | null {
  const preview = useDwPreview();
  const { agentId: activeAgentId } = useActiveNav();
  if (preview.status === "error") {
    return null;
  }
  if (preview.status === "pending") {
    return (
      <>
        {Array.from({ length: DW_PREVIEW }).map((_, i) => (
          <div
            // eslint-disable-next-line react/no-array-index-key -- static placeholder count
            key={i}
            data-testid="sidebar-rail-current-dw-skeleton"
            aria-hidden="true"
            className="flex size-9 items-center justify-center"
          >
            <Skeleton className="size-5 shrink-0 rounded-full" />
          </div>
        ))}
      </>
    );
  }
  const agents = preview.items;
  if (agents.length === 0) {
    return null;
  }
  return (
    <>
      {agents.map((agent) => {
        const isActive = activeAgentId === String(agent.id);
        return (
          <Tooltip key={agent.id}>
            <TooltipTrigger
              render={
                <Link
                  to="/digital-worker/$agentId"
                  params={{ agentId: String(agent.id) }}
                  aria-label={`Open ${agent.name}`}
                  data-testid="sidebar-rail-current-dw"
                  data-active={isActive ? true : undefined}
                  className="hover:bg-surface-muted data-[active]:bg-surface-muted flex size-9 items-center justify-center rounded-lg"
                >
                  <DwAvatar agent={agent} size="xs" decorative />
                </Link>
              }
            />
            <TooltipContent side="right">{agent.name}</TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
