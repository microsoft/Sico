import { useMemo } from "react";

import { type Agent, AgentStatusSchema } from "../schemas/agent";

const isInactive = (a: Agent): boolean =>
  a.status === AgentStatusSchema.enum.INACTIVE;

/**
 * Splits the agent list for the `/digital-worker` grid: inactive DWs are hidden
 * by default and, when revealed, sorted to the end so active workers always
 * lead. Client-side (the list is already paginated in) — mirrors the PR346
 * design draft. Also returns `inactiveCount` for the reveal toggle.
 */
export function useVisibleAgents(
  agents: Agent[],
  showInactive: boolean,
): { visible: Agent[]; inactiveCount: number } {
  return useMemo(() => {
    const inactiveCount = agents.filter(isInactive).length;
    const filtered = showInactive
      ? [...agents].sort(
          (a, b) => Number(isInactive(a)) - Number(isInactive(b)),
        )
      : agents.filter((a) => !isInactive(a));
    return { visible: filtered, inactiveCount };
  }, [agents, showInactive]);
}
