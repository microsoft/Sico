import { type JSX, useEffect, useState } from "react";

import {
  type ToolCallStatus,
  ToolCallStatusSchema,
} from "../../../schemas/plan";

export type FailureAnalyzedLabelProps = {
  status: ToolCallStatus;
  // Live plan cards auto-hide "Failure Analyzed." after 5 s; a card replayed
  // from history shows it permanently.
  streaming?: boolean;
};

const AUTO_HIDE_MS = 5000;

// Sibling note under a failed tool call in an expanded PlanStep, keyed on status:
// FAILED_ANALYZING/FAILED_ANALYZED → transient "Failure Analyzed." (auto-hides
// after 5 s while streaming; permanent in history); RETRY_SUCCESSFUL → persistent
// "Analysis Verified." note. `text-primary-700` is the nearest token to the
// legacy brand purple (no semantic alias exists for this learning accent).
export function FailureAnalyzedLabel({
  status,
  streaming,
}: FailureAnalyzedLabelProps): JSX.Element | null {
  const isFailureAnalyzed =
    status === ToolCallStatusSchema.enum.FAILED_ANALYZING ||
    status === ToolCallStatusSchema.enum.FAILED_ANALYZED;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isFailureAnalyzed || !streaming) {
      return undefined;
    }
    const timer = window.setTimeout(() => setHidden(true), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [isFailureAnalyzed, streaming]);

  if (isFailureAnalyzed) {
    if (hidden) {
      return null;
    }
    return (
      <div className="text-primary-700 leading-body text-sm">
        Failure Analyzed.
      </div>
    );
  }

  if (status === ToolCallStatusSchema.enum.RETRY_SUCCESSFUL) {
    return (
      <div className="text-primary-700 leading-body text-sm">
        Analysis Verified. New experience saved.
      </div>
    );
  }

  return null;
}
