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

import { makeId } from "../../../utils/id";
import { logger } from "../../../utils/logger";
import { type Message } from "../atoms/chat-atom";
import {
  type ChatEvent,
  KNOWN_CONTENT_TYPES,
  MARKDOWN_CONTENT_TYPE,
  PLAN_CONTENT_TYPE,
} from "../schemas/chat-event";

// Pure frame→Part reducer shared by the live chat orchestrator (chat.ts) and
// reconnect replay. No React, no store, no network: it mutates an immer-style
// draft in place — the caller wraps it in `produce`.

// Folds ONE validated SSE frame into the target message's Part list.
export function reduceFrame(
  draft: { history: Message[] },
  messageId: string,
  event: ChatEvent,
): void {
  // `done`/`error` are terminal signals owned by the orchestrator, not the
  // reducer — there is no Part to produce.
  if (event.event !== "message") {
    return;
  }
  const msg = draft.history.find((m) => m.id === messageId);
  if (!msg) {
    return;
  }
  switch (event.data.type) {
    case MARKDOWN_CONTENT_TYPE:
      msg.content.push({
        partId: makeId(),
        type: "text",
        text: event.data.content,
      });
      break;
    case PLAN_CONTENT_TYPE:
      // A plan Part's `planId === String(turnId)`. The streaming schema types
      // `turnId` optional, so guard rather than mint a broken
      // `planId: "undefined"` that PlanCard would poll forever. Stay lenient
      // (skip + warn, never throw) per the streaming policy.
      if (event.data.turnId === undefined) {
        logger.warn("chat: PLAN frame missing turnId", {
          type: event.data.type,
        });
        break;
      }
      msg.content.push({
        partId: makeId(),
        type: "plan",
        planId: String(event.data.turnId),
      });
      break;
    default: {
      // A KNOWN non-markdown type (END/IMAGE/…) is an expected non-rendered
      // frame → `debug`; a type OUTSIDE the documented enum → `warn`. Append
      // nothing.
      const level = KNOWN_CONTENT_TYPES.has(event.data.type)
        ? logger.debug
        : logger.warn;
      level("chat: skipped non-markdown frame", { type: event.data.type });
    }
  }
}

// reset-then-replay: clear the target message's Parts, then fold the full run
// from head. The wire carries no `seq`, so a dropped stream can't dedup
// incrementally — replaying a longer run over a partial tail rebuilds rather
// than double-appends. The run also drives `streamingState`: a reconnect resumes
// a turn whose persisted history row has NO client `streamingState`, so without
// this the composer can't tell the turn is still live (it reads `streaming` off
// the messages). Terminal state is owned by `settleTurn` (driven by the
// machine's terminal `done`/`error`/`stop` events), which can run BEFORE a
// still-pending replay rAF flushes — so a replay must never downgrade an
// already-settled message back to `streaming`, only mark an unsettled one.
// (Mirrors legacy's `SectionStatus.Receiving/Done`.)
export function replayFrames(
  draft: { history: Message[] },
  messageId: string,
  events: ChatEvent[],
): void {
  const msg = draft.history.find((m) => m.id === messageId);
  if (!msg) {
    return;
  }
  msg.content.length = 0;
  for (const event of events) {
    reduceFrame(draft, messageId, event);
  }
  // Only (re)assert `streaming` for a turn the machine hasn't settled yet — a
  // late replay must not revert a `done`/`error` settle (the C1 rAF race).
  if (msg.streamingState !== "done" && msg.streamingState !== "error") {
    msg.streamingState = "streaming";
  }
}
