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
