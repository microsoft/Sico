import { Spinner } from "@sico/ui";
import { type JSX } from "react";

import type { Part } from "../../atoms/chat-atom";
import type { PlanStatus } from "../../schemas/plan";

export type ReceivingIndicatorProps = {
  parts: Part[];
  planStatus?: PlanStatus;
  // "pending" — stream not open yet → bare spinner; "streaming" — open, no part
  // yet → shimmering `Thinking…`; undefined — settled, nothing shows.
  phase?: "pending" | "streaming";
};

// The turn's receiving-phase indicator. `streaming` shows `Thinking…` on two
// triggers: (a) no part has arrived; (b) a plan part exists but is unpolled.
export function ReceivingIndicator({
  parts,
  planStatus,
  phase,
}: ReceivingIndicatorProps): JSX.Element | null {
  if (phase === undefined) {
    return null;
  }
  if (phase === "pending") {
    return <Spinner />;
  }
  const noPartYet = parts.length === 0;
  const planPending = parts[0]?.type === "plan" && planStatus === undefined;
  if (!(noPartYet || planPending)) {
    return null;
  }
  return (
    <span className="bg-gradient-shimmer-text leading-body-2 animate-shimmer bg-[length:200%_100%] bg-clip-text text-base text-transparent">
      Thinking…
    </span>
  );
}
