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

export type ToolCallSubTaskSummaryProps = {
  passed: number;
  failed: number;
  pending: number;
  total: number;
};

// The passed/failed/pending roll-up heading a fan-out step's body. Each count is
// a status dot + `{n}/{total} {label}.` line; the pending line is dropped when
// nothing is pending. `@container`/`@sm` (384px) stacks rows below that width,
// lays them in a row above it.
export function ToolCallSubTaskSummary({
  passed,
  failed,
  pending,
  total,
}: ToolCallSubTaskSummaryProps): JSX.Element {
  return (
    <div className="@container">
      <div className="flex flex-col items-start gap-2 @sm:flex-row @sm:items-center @sm:gap-3">
        <div className="flex items-center gap-1.5">
          <span className="bg-status-success-foreground size-1.5 shrink-0 rounded-full" />
          <span className="text-foreground-secondary text-sm">
            {passed}/{total} passed.
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="bg-status-error-foreground size-1.5 shrink-0 rounded-full" />
          <span className="text-foreground-secondary text-sm">
            {failed}/{total} failed.
          </span>
        </div>
        {pending > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="bg-icon-secondary size-1.5 shrink-0 rounded-full" />
            <span className="text-foreground-secondary text-sm">
              {pending}/{total} pending.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
