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

import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { memo, type ReactElement } from "react";

import { DwInitialAvatar } from "./dw-initial-avatar";
import { type SingleAgentCard } from "../schemas/single-agent-card";

export type StudioCardProps = {
  agent: SingleAgentCard;
};

/**
 * Card for a single digital worker in the Studio list. Renders as a link to
 * the DW's setup page. Styling follows the Figma Studio card (`DE name card`):
 * initial-based neutral avatar, medium-weight name, and a creator line —
 * sourced from the `single_agent_infos` contract (`SingleAgentCard`).
 */
function StudioCardImpl({ agent }: StudioCardProps): ReactElement {
  return (
    <Link
      to="/studio/$agentId/setup"
      params={{ agentId: agent.agentId }}
      aria-label={`Open ${agent.name}'s setup`}
      className="border-stroke-subtle-card-rest bg-surface-basic hover:border-stroke-subtle-card-hover hover:shadow-m focus-visible:outline-focus-rest active:border-stroke-subtle-card-pressed flex h-32 w-full flex-col items-start justify-between rounded-xl border p-5 no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <div className="flex w-full min-w-0 items-center gap-3">
        <DwInitialAvatar name={agent.name} size={40} fontSize={16} decorative />
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground-primary truncate text-xl leading-tight font-medium">
            {agent.name}
          </span>
          {agent.role ? (
            <span className="text-foreground-tertiary w-full truncate text-sm leading-tight">
              {agent.role}
            </span>
          ) : null}
        </div>
      </div>
      {agent.creatorUsername ? (
        <div className="text-foreground-tertiary flex w-full items-center gap-1.5 overflow-hidden">
          <User
            data-testid="creator-icon"
            className="size-3.5 shrink-0"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm leading-tight">
            {agent.creatorUsername}
          </span>
        </div>
      ) : null}
    </Link>
  );
}

export const StudioCard = memo(StudioCardImpl);
