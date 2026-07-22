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
