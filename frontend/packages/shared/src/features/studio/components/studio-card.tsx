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
      className="bg-surface-basic border-stroke-subtle-card-rest hover:border-stroke-subtle-card-hover hover:shadow-m active:border-stroke-subtle-card-pressed focus-visible:outline-focus-rest flex h-32 w-full flex-col items-start justify-between rounded-xl border p-5 no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
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
