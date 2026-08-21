import { cn } from "@sico/ui/lib/utils.ts";
import { Loader2 } from "lucide-react";
import { type JSX } from "react";

import { Deliverable } from "./deliverable";
import { FailureAnalyzedLabel } from "./failure-analyzed-label";
import { ToolCallSubTaskList } from "./tool-call-subtask-list";
import { ToolCallSubTaskSummary } from "./tool-call-subtask-summary";
import { ToolMessage } from "./tool-message";
import {
  type PlanStep as PlanStepModel,
  PlanStepStatusSchema,
  type ToolCall,
  ToolCallStatusSchema,
} from "../../../schemas/plan";

export type PlanStepProps = {
  step: PlanStepModel;
  // Live plan; threaded to each FailureAnalyzedLabel so the 5 s auto-hide only
  // runs while streaming. Defaults false — a history step is settled.
  streaming?: boolean;
  // Adjacency drives the guide line: the segment ABOVE the dot shows only with a
  // step above (`!isFirstStep`), the segment BELOW only with a step below
  // (`!isLastStep`). A lone step (first AND last) renders a bare dot, no line.
  // Both default true so a standalone render shows no dangling line.
  isFirstStep?: boolean;
  isLastStep?: boolean;
};

type SubTaskSummary = {
  total: number;
  passed: number;
  failed: number;
  pending: number;
};

// Bucket every sub-call by status into passed / failed / pending. UNKNOWN counts
// toward `total` only — it lands in no bucket.
function summarize(subCalls: ToolCall[]): SubTaskSummary {
  const summary: SubTaskSummary = {
    total: subCalls.length,
    passed: 0,
    failed: 0,
    pending: 0,
  };
  for (const call of subCalls) {
    switch (call.status) {
      case ToolCallStatusSchema.enum.SUCCESSFUL:
      case ToolCallStatusSchema.enum.RETRY_SUCCESSFUL:
        summary.passed += 1;
        break;
      case ToolCallStatusSchema.enum.FAILED:
      case ToolCallStatusSchema.enum.RETRY_FAILED:
      case ToolCallStatusSchema.enum.FAILED_ANALYZED:
      case ToolCallStatusSchema.enum.FAILED_ANALYZING:
        summary.failed += 1;
        break;
      case ToolCallStatusSchema.enum.RUNNING:
      case ToolCallStatusSchema.enum.RETRY_RUNNING:
      case ToolCallStatusSchema.enum.PENDING:
        summary.pending += 1;
        break;
      default:
        break;
    }
  }
  return summary;
}

// The left-rail status glyph keyed on the STEP status (PlanStepStatus, distinct
// from the tool-call enum): IN_PROGRESS spins; FAILED is the error dot; every
// other state is the muted dot. Plain render helper, not a component
// (react/no-multi-comp).
function renderStatusGlyph(status: PlanStepModel["status"]): JSX.Element {
  if (status === PlanStepStatusSchema.enum.IN_PROGRESS) {
    return (
      <Loader2 className="text-icon-secondary size-3 shrink-0 animate-spin" />
    );
  }
  if (status === PlanStepStatusSchema.enum.FAILED) {
    return (
      <span className="bg-status-error-foreground size-1.5 shrink-0 rounded-full" />
    );
  }
  return <span className="bg-icon-secondary size-1.5 shrink-0 rounded-full" />;
}

// One plan step inside an expanded PlanCard. Left rail = a vertical guide line
// with the status glyph centred on it (two segments so the dot sits on the
// connector; the last step omits the lower one). Right column = title, an
// optional passed/failed/pending roll-up when tool calls fanned out, then the
// per-toolCall body. Every child self-nullifies.
export function PlanStep({
  step,
  streaming = false,
  isFirstStep = true,
  isLastStep = true,
}: PlanStepProps): JSX.Element {
  const subCalls = step.toolCalls.flatMap((tool) => tool.subCalls);
  const summary = summarize(subCalls);

  return (
    <div className="flex gap-2">
      {/* Rail column (shared w-4 lane with the header). The guide line is built
          from independent w-0 pieces so every border-l lands on the SAME center
          axis — the dot sits centered on the line, and the line stays unbroken
          where present. The dot's row is h-6 + py-0.5 to match the title's first
          line box (py-0.5 + text-sm's 20px line-height + py-0.5 = 24px), so the
          dot centers vertically on the title regardless of glyph size. A shorter
          rail row would sit the glyph a couple px high — most visible on the
          size-3 spinner. Adjacency gates each half: the upper half shows only with a step
          above, the lower half + flex-1 only with a step below. A lone step
          renders a bare dot — no line. */}
      <div className="flex w-4 shrink-0 flex-col items-center self-stretch">
        <div className="flex h-6 flex-col items-center py-0.5">
          <div
            className={cn(
              "w-0 flex-1",
              !isFirstStep && "border-stroke-subtle-card-rest border-l",
            )}
          />
          {renderStatusGlyph(step.status)}
          <div
            className={cn(
              "w-0 flex-1",
              !isLastStep && "border-stroke-subtle-card-rest border-l",
            )}
          />
        </div>
        {!isLastStep && (
          <div className="border-stroke-subtle-card-rest w-0 flex-1 border-l" />
        )}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-2",
          !isLastStep && "pb-3",
        )}
      >
        <div className="text-foreground-secondary py-0.5 text-sm font-medium break-all">
          {step.title}
        </div>
        {subCalls.length > 0 && (
          <ToolCallSubTaskSummary
            passed={summary.passed}
            failed={summary.failed}
            pending={summary.pending}
            total={summary.total}
          />
        )}
        {step.toolCalls.map((tool) => (
          <div key={tool.toolCallId} className="flex min-w-0 flex-col gap-2">
            <ToolMessage toolCall={tool} />
            <ToolCallSubTaskList subCalls={tool.subCalls} />
            <FailureAnalyzedLabel status={tool.status} streaming={streaming} />
            <Deliverable deliverables={tool.deliverables ?? []} />
          </div>
        ))}
      </div>
    </div>
  );
}
