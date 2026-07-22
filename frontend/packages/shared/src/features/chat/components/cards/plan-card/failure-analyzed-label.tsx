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
      <div className="leading-body text-primary-700 text-sm">
        Failure Analyzed.
      </div>
    );
  }

  if (status === ToolCallStatusSchema.enum.RETRY_SUCCESSFUL) {
    return (
      <div className="leading-body text-primary-700 text-sm">
        Analysis Verified. New experience saved.
      </div>
    );
  }

  return null;
}
