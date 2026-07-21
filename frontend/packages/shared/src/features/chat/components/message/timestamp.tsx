import { type JSX } from "react";

import { formatDateTime } from "../../utils/format-date-time";

export type TimestampProps = {
  createdAt?: number;
  streaming?: boolean;
  planRunning?: boolean;
};

// Per-turn timestamp. Hidden while the turn is still receiving, its plan is
// RUNNING, or no time exists yet.
export function Timestamp({
  createdAt,
  streaming,
  planRunning,
}: TimestampProps): JSX.Element | null {
  if (createdAt === undefined || streaming || planRunning) {
    return null;
  }
  return (
    <time
      dateTime={new Date(createdAt).toISOString()}
      className="text-foreground-tertiary leading-body text-xs tracking-wide whitespace-nowrap"
    >
      {formatDateTime(createdAt)}
    </time>
  );
}
