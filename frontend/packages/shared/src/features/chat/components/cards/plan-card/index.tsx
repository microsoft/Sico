import { cn } from "@sico/ui/lib/utils.ts";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { type JSX, useMemo, useState } from "react";

import { PlanStep } from "./plan-step";
import { usePlan } from "../../../hooks/use-plan";
import { usePlanById } from "../../../hooks/use-plan-by-id";
import {
  type PlanStatus,
  PlanStatusSchema,
  PlanStepStatusSchema,
} from "../../../schemas/plan";
import {
  useChatAgentId,
  useChatConversationId,
} from "../../../services/chat-agent-context";

export type PlanCardProps = {
  // The plan tree's id (= `String(turnId)`); the card reads `plansAtom` by this
  // key and owns the `/plan` poll that fills it. History hands the card a plan
  // pointer only, so the card that needs the tree mounts the poll for it.
  // `use-plan` is the sole writer of `plansAtom`; this card never writes it.
  planId: string;
};

// RUNNING / UNKNOWN / NO_PLAN read as "in progress"; COMPLETED +
// REQUIRE_HUMAN_INPUT as "completed"; FAILED / CANCELLED get their own line.
// Plain lookup helper, not a component (react/no-multi-comp).
function statusLabel(status: PlanStatus): string {
  switch (status) {
    case PlanStatusSchema.enum.COMPLETED:
    case PlanStatusSchema.enum.REQUIRE_HUMAN_INPUT:
      return "Execution completed";
    case PlanStatusSchema.enum.FAILED:
      return "Execution failed";
    case PlanStatusSchema.enum.CANCELLED:
      return "Execution stopped";
    default:
      return "Execution in progress";
  }
}

// Leading header glyph, one per status (restored from legacy PlanCard): RUNNING
// spins; COMPLETED / REQUIRE_HUMAN_INPUT show a check; FAILED a warning; CANCELLED
// a dismiss. UNKNOWN / NO_PLAN read as in-progress and carry no glyph. Colors map
// legacy's hexes to the nearest semantic token (neutral check, error warning,
// muted dismiss). Plain lookup helper, not a component (react/no-multi-comp).
function renderHeaderStatusIcon(status: PlanStatus): JSX.Element | null {
  const iconClass = "size-3 shrink-0";
  switch (status) {
    case PlanStatusSchema.enum.RUNNING:
      return (
        <Loader2
          data-testid="plan-status-icon"
          className={cn(iconClass, "text-icon-secondary animate-spin")}
        />
      );
    case PlanStatusSchema.enum.COMPLETED:
    case PlanStatusSchema.enum.REQUIRE_HUMAN_INPUT:
      return (
        <CircleCheck
          data-testid="plan-status-icon"
          className={cn(iconClass, "text-foreground-primary")}
        />
      );
    case PlanStatusSchema.enum.FAILED:
      return (
        <TriangleAlert
          data-testid="plan-status-icon"
          className={cn(iconClass, "text-status-error-foreground")}
        />
      );
    case PlanStatusSchema.enum.CANCELLED:
      return (
        <CircleX
          data-testid="plan-status-icon"
          className={cn(iconClass, "text-icon-secondary")}
        />
      );
    default:
      return null;
  }
}

// Plan execution card. Header = status glyph + label + chevron; the expanded
// body lists executed steps.
//
// Collapse is a render-time state machine, NOT `useState(true)`:
//   • Seed from the FIRST observed status — RUNNING seeds expanded, terminal
//     seeds collapsed, so a done plan (history/reconnect) never opens just
//     because no live edge fired.
//   • Auto-collapse ONCE on the RUNNING→terminal edge. It's an edge, not a
//     level: re-checking `status !== RUNNING` every poll would re-collapse a
//     card the user manually reopened. After the edge, expand/collapse is theirs.
// Uses the "adjust state during render" pattern (store prev status, reconcile on
// change) — no effect, no flash.
export function PlanCard({ planId }: PlanCardProps): JSX.Element | null {
  // Mount the turn's `/plan` poll: this card is the sole consumer of the plan
  // tree, so it owns the fetch that fills `plansAtom`. `use-plan` self-stops on
  // a terminal status, so a finished historical plan polls once and quits.
  // Called before any early return — hooks run unconditionally.
  usePlan(useChatAgentId(), Number(planId), useChatConversationId());

  const plan = usePlanById(planId);
  const status = plan?.status;

  // Memo footgun: `steps.filter` allocates a new array each poll, so it lives in
  // a memo keyed on the stable `steps` ref (immer keeps that ref intact across an
  // unchanged poll) — else by-id stability never reaches the PlanStep subtree.
  // `PlanStepStatus.PENDING` (=1), NOT the distinct `ToolCallStatus.PENDING` (=9).
  const executedSteps = useMemo(
    () =>
      (plan?.steps ?? []).filter(
        (step) => step.status !== PlanStepStatusSchema.enum.PENDING,
      ),
    [plan?.steps],
  );

  const [expanded, setExpanded] = useState(false);
  const [prevStatus, setPrevStatus] = useState<PlanStatus | undefined>(
    undefined,
  );

  if (status !== prevStatus) {
    if (prevStatus === undefined) {
      setExpanded(status === PlanStatusSchema.enum.RUNNING);
    } else if (
      prevStatus === PlanStatusSchema.enum.RUNNING &&
      status !== PlanStatusSchema.enum.RUNNING
    ) {
      setExpanded(false);
    }
    setPrevStatus(status);
  }

  // History hands a plan pointer; the tree arrives a beat later via the poll.
  // Reserve the header height with an empty `h-9` spacer instead of collapsing
  // to 0 → no layout shift when the poll resolves on history load (#190).
  if (status === undefined) {
    return <div data-testid="plan-header-spacer" className="h-9" />;
  }
  // Plan known but no steps → nothing to show (ReceivingIndicator covers this
  // window). Gate on the RAW step count, not `executedSteps`: a fresh RUNNING
  // plan has all steps PENDING (filtered out of the body) but the header must
  // still show.
  if ((plan?.steps.length ?? 0) === 0) {
    return null;
  }

  const isRunning = status === PlanStatusSchema.enum.RUNNING;
  const headerIcon = renderHeaderStatusIcon(status);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div>
      {/* Header + body share ONE rail column (`w-4`), so the status glyph and
          every step dot sit on a single vertical axis and the guide line runs
          unbroken. The header's rail cell carries the icon plus, while expanded,
          a `flex-1` connector down to the first step's dot. Wrapped in one block
          (not a Fragment): the collapsed body is still a flex sibling, so loose
          children would double the parent's gap-4 below a collapsed card. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="focus-visible:outline-focus-rest flex w-full items-stretch gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {/* Rail column renders for every status that carries a header glyph
            (RUNNING spinner + the terminal check / warning / dismiss). UNKNOWN /
            NO_PLAN have no glyph → no lane, so the label sits flush-left rather
            than indented past an empty rail. */}
        {headerIcon && (
          <div className="flex w-4 shrink-0 flex-col items-center">
            <span className="flex h-9 items-center">{headerIcon}</span>
            {expanded && (
              <div
                data-testid="header-connector"
                className="border-stroke-subtle-card-rest w-0 flex-1 border-l"
              />
            )}
          </div>
        )}
        {/* min-w-0 wrapper bounds the row so a long label truncates instead of
            shoving the chevron off-screen; the chevron stays glued to the text. */}
        <span className="flex h-9 min-w-0 items-center gap-2">
          <span className="text-foreground-primary truncate text-sm">
            {statusLabel(status)}
          </span>
          <Chevron className="text-foreground-primary size-4 shrink-0" />
        </span>
      </button>
      {/* Height animation via grid-template-rows 0fr↔1fr. Body is ALWAYS mounted
          so the transition has both states to animate between; inner
          `overflow-hidden min-h-0` clips while collapsed. */}
      <div
        data-testid="plan-animator"
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            data-testid="plan-body"
            className={cn(
              "flex flex-col",
              !isRunning && "border-stroke-subtle-card-rest border-b pb-4",
            )}
          >
            {executedSteps.map((step, index) => (
              <PlanStep
                key={step.id}
                step={step}
                streaming={isRunning}
                isFirstStep={index === 0}
                isLastStep={index === executedSteps.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
