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

import { Loader2 } from "lucide-react";
import { type JSX, useMemo, useState } from "react";

import {
  type ToolCall,
  type ToolCallStatus,
  ToolCallStatusSchema,
} from "../../../schemas/plan";

export type ToolCallSubTaskListProps = {
  subCalls: ToolCall[];
};

const MAX_VISIBLE = 3;

// Render-order weight per status: in-flight first, then settled-ok, then failed,
// then pending/unknown. Keyed by numeric status so a new code defaults to last.
const STATUS_ORDER: Record<ToolCallStatus, number> = {
  [ToolCallStatusSchema.enum.RUNNING]: 0,
  [ToolCallStatusSchema.enum.FAILED_ANALYZING]: 1,
  [ToolCallStatusSchema.enum.RETRY_RUNNING]: 2,
  [ToolCallStatusSchema.enum.SUCCESSFUL]: 3,
  [ToolCallStatusSchema.enum.FAILED_ANALYZED]: 4,
  [ToolCallStatusSchema.enum.RETRY_SUCCESSFUL]: 5,
  [ToolCallStatusSchema.enum.FAILED]: 6,
  [ToolCallStatusSchema.enum.RETRY_FAILED]: 7,
  [ToolCallStatusSchema.enum.UNKNOWN]: 8,
  [ToolCallStatusSchema.enum.PENDING]: 9,
};

// The status glyph leading each sub-call row: running-family → spinner, terminal
// → colored dot, unknown → none. Plain render helper, not a component
// (react/no-multi-comp).
function renderStatusGlyph(status: ToolCallStatus): JSX.Element | null {
  switch (status) {
    case ToolCallStatusSchema.enum.RUNNING:
    case ToolCallStatusSchema.enum.RETRY_RUNNING:
    case ToolCallStatusSchema.enum.FAILED_ANALYZING:
    case ToolCallStatusSchema.enum.FAILED_ANALYZED:
      return (
        <Loader2 className="text-icon-secondary size-3 shrink-0 animate-spin" />
      );
    case ToolCallStatusSchema.enum.FAILED:
    case ToolCallStatusSchema.enum.RETRY_FAILED:
      return (
        <span className="bg-status-error-foreground size-1.5 shrink-0 rounded-full" />
      );
    case ToolCallStatusSchema.enum.SUCCESSFUL:
    case ToolCallStatusSchema.enum.RETRY_SUCCESSFUL:
      return (
        <span className="bg-status-success-foreground size-1.5 shrink-0 rounded-full" />
      );
    case ToolCallStatusSchema.enum.PENDING:
      return (
        <span className="bg-icon-secondary size-1.5 shrink-0 rounded-full" />
      );
    default:
      return null;
  }
}

// The nested sub-tool-call list under a fan-out step. Rows are status-sorted
// (running first); only the first 3 show until a "Show more" toggle reveals the
// rest, which "Show less" hides again.
export function ToolCallSubTaskList({
  subCalls,
}: ToolCallSubTaskListProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () =>
      [...subCalls].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      ),
    [subCalls],
  );

  if (subCalls.length === 0) {
    return null;
  }

  const hasMore = sorted.length > MAX_VISIBLE;
  const visible = expanded ? sorted : sorted.slice(0, MAX_VISIBLE);

  return (
    <div className="flex flex-col gap-2">
      {visible.map((call) => (
        <div key={call.toolCallId} className="flex items-center gap-2">
          {renderStatusGlyph(call.status)}
          <div
            className="text-foreground-secondary line-clamp-1 text-sm"
            title={call.toolName}
          >
            {call.toolName}
          </div>
        </div>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="leading-body text-foreground-tertiary hover:text-foreground-secondary focus-visible:outline-focus-rest flex w-fit cursor-pointer items-center rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
