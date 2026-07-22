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

import { type JSX, useMemo } from "react";

import { FileTile } from "../../../../components/file-tile";
import { usePlanById } from "../../hooks/use-plan-by-id";
import { useSidepaneActions } from "../../hooks/use-sidepane";
import { buildSidepaneContent } from "../../utils/build-sidepane-content";
import {
  deliverableIcon,
  toRenderableDeliverables,
} from "../../utils/deliverable";

export type PlanSummaryProps = {
  planId: string;
};

// Completed-plan deliverable summary: result cards rendered as a sibling below
// the collapsed PlanCard, derived render-time from the store `Plan`.
// Report deliverables = deliverables of every tool call whose
// `executionInfo.builtinToolName === "report"`. Match on `builtinToolName`, NOT
// `toolName` (the human/localizable label). Renders nothing until a report tool
// exists (plan still running).
export function PlanSummary({ planId }: PlanSummaryProps): JSX.Element | null {
  const plan = usePlanById(planId);
  const { open } = useSidepaneActions();

  const cards = useMemo(() => {
    const deliverables = (plan?.steps ?? [])
      .flatMap((step) => step.toolCalls)
      .filter((tool) => tool.executionInfo?.builtinToolName === "report")
      .flatMap((tool) => tool.deliverables ?? []);
    return toRenderableDeliverables(deliverables);
  }, [plan?.steps]);

  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {cards.map((card) => (
        <FileTile
          key={card.id}
          filename={card.label}
          icon={deliverableIcon(card)}
          onActivate={() => {
            const content = buildSidepaneContent(card);
            if (content) {
              open(content);
            }
          }}
        />
      ))}
    </div>
  );
}
