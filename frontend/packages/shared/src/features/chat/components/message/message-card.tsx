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

import { type JSX, memo, useMemo } from "react";

import { AttachmentList } from "./attachment-list";
import { ExperiencePill } from "./experience-pill";
import { PlanSummary } from "./plan-summary";
import { ReceivingIndicator } from "./receiving-indicator";
import { Timestamp } from "./timestamp";
import { type Message } from "../../atoms/chat-atom";
import { usePlanById } from "../../hooks/use-plan-by-id";
import { PlanStatusSchema } from "../../schemas/plan";
import { AgentCard } from "../cards/agent-card";
import { PlanCard } from "../cards/plan-card";
import { UserCard } from "../cards/user-card";

export type MessageCardProps = {
  message: Message;
};

// One turn = two phases. Phase (a) routes each `content[]` part by author ×
// type to a `cards/` renderer; phase (b) renders turn-level siblings AFTER the
// loop, each derived read-only off the same Plan/envelope.
// Memoized on message identity: immer's structural sharing keeps a settled
// turn's reference stable across a streaming frame, so completed rows bail out
// of re-render while only the tail re-parses.
function MessageCardImpl({ message }: MessageCardProps): JSX.Element {
  const { author, content, attachments, streamingState, createdAt } = message;
  const isAgent = author === "ai";
  const streaming = streamingState === "streaming";
  // Drives the receiving indicator. `streaming` (markdown/timestamp) stays
  // narrower so a settled-time read never fires during the pending gap.
  const receivingPhase =
    streamingState === "pending" || streamingState === "streaming"
      ? streamingState
      : undefined;
  const experienceCount = message.experienceCount ?? 0;

  // One card per turn — every text part concatenated into one body.
  const text = useMemo(
    () =>
      content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    [content],
  );

  // "" when no plan, so `usePlanById` (which must run unconditionally) reads it
  // as undefined.
  const planId = useMemo(
    () => content.find((part) => part.type === "plan")?.planId ?? "",
    [content],
  );

  const plan = usePlanById(planId);
  const planRunning = plan?.status === PlanStatusSchema.enum.RUNNING;
  const planCompleted =
    plan?.status === PlanStatusSchema.enum.COMPLETED ||
    plan?.status === PlanStatusSchema.enum.REQUIRE_HUMAN_INPUT;

  return (
    <div
      data-author={author}
      data-message-id={message.id}
      className="flex flex-col gap-4 data-[author=human]:items-end"
    >
      {attachments && attachments.length > 0 && (
        <AttachmentList attachments={attachments} />
      )}

      {/* Phase (a) — routed parts. Plan on top, text below. A human turn never
          has a plan, so UserCard renders directly — wrapping it would drop its
          `ml-auto` right-alignment. The receiving indicator leads the turn so
          `Thinking…`/spinner shows at the top, not under an empty plan spacer. */}
      <ReceivingIndicator
        parts={content}
        planStatus={plan?.status}
        phase={receivingPhase}
      />
      {planId && <PlanCard planId={planId} />}
      {text &&
        (isAgent ? (
          <AgentCard text={text} streaming={streaming} />
        ) : (
          <UserCard text={text} />
        ))}

      {/* Phase (b) — turn-level siblings. PlanSummary needs a plan, so it stays
          gated on planId. ExperiencePill is NOT gated: experienceCount rides
          the turn's type=8 item independent of any plan (legacy parity), and
          the pill self-nullifies when there's nothing to show. */}
      {planId && <PlanSummary planId={planId} />}
      <ExperiencePill
        experienceCount={experienceCount}
        planCompleted={planCompleted}
        playbookId={message.experiencePlaybookId}
      />
      <Timestamp
        createdAt={createdAt}
        streaming={streaming}
        planRunning={planRunning}
      />
    </div>
  );
}

export const MessageCard = memo(MessageCardImpl);
