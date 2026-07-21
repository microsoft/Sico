import { Button } from "@sico/ui";
import { ScreenShare } from "lucide-react";
import { type JSX } from "react";

import { useAgentQuery } from "../../digital-worker/hooks/use-agents-query";
import { useSidepaneActions } from "../hooks/use-sidepane";

export type DeviceButtonProps = {
  agentInstanceId: number;
};

/**
 * Opens the sandbox sidepane for the active agent — the trigger legacy parked
 * in its page-level collaboration Header (D1 OQ7 deferred this until a home
 * existed; D2 lands it in that Header's actions slot). Icon-only; the
 * `aria-label` names it for assistive tech. Carries `agentInstanceId` in the
 * content so the previewer can poll `/sandbox/instance` off it.
 *
 * Renders nothing when the agent has no sandboxes (legacy gated the entry on
 * `agent.sandboxes.length > 0`). Reuses the Header's cached agent-detail query
 * via react-query, so this adds no extra request.
 */
export function DeviceButton({
  agentInstanceId,
}: DeviceButtonProps): JSX.Element | null {
  const { open } = useSidepaneActions();
  const { data: agent } = useAgentQuery(agentInstanceId);

  // No devices → no entry (matches legacy). Also covers the brief pre-cache
  // window before the agent detail resolves.
  if (!agent?.sandboxes?.length) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      aria-label="Device"
      onClick={() => open({ kind: "sandbox", agentInstanceId })}
    >
      <ScreenShare />
    </Button>
  );
}
