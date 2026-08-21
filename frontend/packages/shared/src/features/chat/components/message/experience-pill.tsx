import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Lightbulb } from "lucide-react";
import { type JSX } from "react";

import { useAgentQuery } from "../../../digital-worker/hooks/use-agents-query";
import { useChatAgentId } from "../../services/chat-agent-context";

export type ExperiencePillProps = {
  experienceCount: number;
  planCompleted: boolean;
  playbookId?: number;
};

// Three states off experienceCount + plan completion: count > 0 → pill +
// popover; completed with 0 → `Generating experience`; running with 0 → null.
// The popover's `New strategies` count deliberately mirrors the title count
// (legacy parity); a real two-count split needs an ACE field the store lacks.
export function ExperiencePill({
  experienceCount,
  planCompleted,
  playbookId,
}: ExperiencePillProps): JSX.Element | null {
  const navigate = useNavigate();
  // The owning project for `View more` — read from the live agent (same path as
  // AddToProjectButton). `useAgentQuery` (non-suspense) so the pill never
  // suspends; an undefined projectId just disables the jump.
  const agentInstanceId = useChatAgentId();
  const { data: agent } = useAgentQuery(agentInstanceId);
  const projectId = agent?.project?.id;
  if (experienceCount <= 0) {
    if (!planCompleted) {
      return null;
    }
    // Completed but no experience yet: a bare non-interactive label, no pill
    // shell (matches legacy `Generating` state).
    return (
      <span className="text-foreground-secondary flex w-fit items-center gap-1 text-sm font-medium">
        <Lightbulb className="text-icon-secondary size-4 shrink-0" />
        Generating experience
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger className="bg-button-subtle-fill-rest text-foreground-secondary hover:bg-button-subtle-fill-hover flex h-5 w-fit items-center gap-1 rounded-md px-2 text-xs font-medium">
        <Lightbulb className="text-icon-secondary size-4 shrink-0" />
        {`Experience + ${experienceCount}`}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-3">
        <PopoverTitle className="flex items-center gap-1.5 text-sm">
          Experience
          <span className="bg-primary-50 text-primary-600 rounded-sm px-1 text-xs">
            {`+ ${experienceCount}`}
          </span>
        </PopoverTitle>
        {/* Count mirrors the title's — a label, not a distinct datum. */}
        <span className="text-foreground-secondary flex items-center justify-between text-xs">
          New strategies
          <span className="bg-primary-50 text-primary-600 rounded-sm px-1">
            {`+ ${experienceCount}`}
          </span>
        </span>
        <button
          type="button"
          disabled={playbookId === undefined || projectId === undefined}
          onClick={() => {
            if (playbookId === undefined || projectId === undefined) {
              return;
            }
            void navigate({
              to: "/project/$projectId/experience/$assetId",
              params: {
                projectId: String(projectId),
                assetId: String(playbookId),
              },
            });
          }}
          className="text-foreground-secondary focus-visible:outline-focus-rest flex w-fit items-center gap-1 rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default"
        >
          View more
          <ChevronRight className="size-3 shrink-0" />
        </button>
      </PopoverContent>
    </Popover>
  );
}
