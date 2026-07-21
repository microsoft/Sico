import { type ReactElement } from "react";

import { StudioCard } from "./studio-card";
import { StudioEmpty } from "./studio-empty";
import { CardGrid } from "../../../components/card-grid";
import { useAgentInfosSuspenseQuery } from "../hooks/use-agent-infos-query";

/**
 * Grid of `/studio`. The legacy `single_agent_infos` endpoint returns the full
 * list in one shot (no pagination), so this renders every card at once. Errors
 * are not handled here — the suspense hook throws to the `<ErrorBoundary>`
 * mounted in `<Studio>`.
 */
export function StudioGrid(): ReactElement {
  const { data: agents } = useAgentInfosSuspenseQuery();

  if (agents.length === 0) {
    return <StudioEmpty />;
  }

  return (
    <CardGrid>
      {agents.map((agent) => (
        <StudioCard key={agent.agentId} agent={agent} />
      ))}
    </CardGrid>
  );
}
