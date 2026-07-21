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
