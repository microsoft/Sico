import { type JSX } from "react";

import type { ToolCall } from "../../../schemas/plan";

export type ToolMessageProps = {
  toolCall: ToolCall;
};

// One tool call's status line inside an expanded PlanStep. Hidden when the
// message is absent, or for the `run_tasks` fan-out (its children surface via
// ToolCallSubTaskList, so its own message would be redundant).
export function ToolMessage({
  toolCall,
}: ToolMessageProps): JSX.Element | null {
  if (
    !toolCall.message ||
    toolCall.executionInfo?.builtinToolName === "run_tasks"
  ) {
    return null;
  }
  return (
    <div className="text-foreground-secondary leading-body w-full min-w-0 text-sm break-words">
      {toolCall.message}
    </div>
  );
}
