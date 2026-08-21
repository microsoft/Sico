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
