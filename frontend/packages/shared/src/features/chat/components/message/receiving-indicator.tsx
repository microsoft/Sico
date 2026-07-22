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
    <span className="animate-shimmer bg-gradient-shimmer-text leading-body-2 bg-[length:200%_100%] bg-clip-text text-base text-transparent">
      Thinking…
    </span>
  );
}
