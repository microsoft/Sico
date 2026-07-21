import { type JSX, type ReactNode } from "react";

import { DwAvatar } from "../../../components/dw-avatar";
import { type Agent } from "../schemas/agent";

/**
 * Content of the collaboration header's agent-info popover — a 1:1 restyle of
 * legacy `MorePopover`: the agent's avatar + name/role, then its Project and
 * Operator. Rendered inside a `PopoverContent` that owns the 300px width and
 * drops its default padding (`w-75 p-0`); the `px-4` sections here reproduce
 * legacy's spacing. The trigger is the header's name row.
 */
export function AgentInfoPopover({ agent }: { agent: Agent }): JSX.Element {
  const nameLine = agent.role ? `${agent.name}, ${agent.role}` : agent.name;
  // Render a row only when its value exists, so an absent Project / Operator
  // leaves no blank line (legacy showed empty rows; product wants them hidden).
  const rows: readonly { label: string; value: string }[] = [
    ...(agent.project?.name
      ? [{ label: "Project", value: agent.project.name }]
      : []),
    ...(agent.operatorUsername
      ? [{ label: "Operator", value: agent.operatorUsername }]
      : []),
  ];
  const row = (label: string, value: string): ReactNode => (
    <div key={label} className="flex items-center justify-between gap-2">
      <span className="text-foreground-tertiary shrink-0">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col text-base">
      <div className="flex items-center gap-2 px-4 py-3">
        <DwAvatar agent={agent} size="sm" decorative />
        <span className="min-w-0 truncate font-medium">{nameLine}</span>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2 px-4 pt-2 pb-3">
          {rows.map((r) => row(r.label, r.value))}
        </div>
      ) : null}
    </div>
  );
}
