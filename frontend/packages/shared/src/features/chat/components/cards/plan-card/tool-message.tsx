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
    <div className="leading-body text-foreground-secondary w-full min-w-0 text-sm break-words">
      {toolCall.message}
    </div>
  );
}
