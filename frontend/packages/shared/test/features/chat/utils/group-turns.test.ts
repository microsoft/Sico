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

import { describe, expect, it } from "vitest";

import { type Message } from "@/features/chat/atoms/chat-atom";
import { type Plan, PlanStatusSchema } from "@/features/chat/schemas/plan";
import { groupTurns } from "@/features/chat/utils/group-turns";

// The backend splits ONE logical turn across several MessageItems that share a
// `turnId` (verified live: a turn = user/text + assistant/plan + assistant/text
// + assistant/experience). `messageItemSchema` maps each item 1:1 to a Message,
// so `groupTurns` folds same-(turnId, author) Messages into one rendered turn —
// the consolidation `MessageCard` already expects (plan on top, text below, one
// timestamp).

describe("groupTurns", () => {
  it("folds same-turn assistant items into one Message (plan + text, latest time)", () => {
    const human: Message = {
      id: "20",
      author: "human",
      content: [{ partId: "20:0", type: "text", text: "make espresso" }],
      turnId: 10,
      createdAt: 100,
    };
    const aiPlan: Message = {
      id: "21",
      author: "ai",
      content: [{ partId: "21:0", type: "plan", planId: "10" }],
      turnId: 10,
      createdAt: 200,
    };
    const aiText: Message = {
      id: "24",
      author: "ai",
      content: [{ partId: "24:0", type: "text", text: "Here you go" }],
      turnId: 10,
      createdAt: 300,
    };
    const aiExperience: Message = {
      id: "25",
      author: "ai",
      content: [], // type 8 → empty content, but its time is the latest
      turnId: 10,
      createdAt: 400,
    };

    const grouped = groupTurns([human, aiPlan, aiText, aiExperience]);

    expect(grouped).toEqual([
      {
        id: "20",
        author: "human",
        content: [{ partId: "20:0", type: "text", text: "make espresso" }],
        turnId: 10,
        createdAt: 100,
      },
      {
        id: "21", // first assistant item of the turn — stable identity
        author: "ai",
        content: [
          { partId: "21:0", type: "plan", planId: "10" },
          { partId: "24:0", type: "text", text: "Here you go" },
        ],
        turnId: 10,
        createdAt: 400, // latest part's time (design Timestamp rule)
      },
    ]);
  });

  it("keeps separate turns separate and preserves oldest→newest order", () => {
    const t8: Message = {
      id: "8",
      author: "ai",
      content: [{ partId: "8:0", type: "text", text: "a" }],
      turnId: 8,
      createdAt: 80,
    };
    const t9: Message = {
      id: "9",
      author: "human",
      content: [{ partId: "9:0", type: "text", text: "b" }],
      turnId: 9,
      createdAt: 90,
    };

    const grouped = groupTurns([t8, t9]);

    expect(grouped.map((m) => m.id)).toEqual(["8", "9"]);
    expect(grouped[0]).toEqual(t8);
    expect(grouped[1]).toEqual(t9);
  });

  it("merges attachments across a turn's items", () => {
    const human: Message = {
      id: "20",
      author: "human",
      content: [{ partId: "20:0", type: "text", text: "see file" }],
      turnId: 5,
      createdAt: 10,
      attachments: [
        { name: "a.pdf", size: 1, type: "pdf", uri: "u1", id: "1" },
      ],
    };
    const humanFollow: Message = {
      id: "22",
      author: "human",
      content: [],
      turnId: 5,
      createdAt: 20,
      attachments: [
        { name: "b.png", size: 2, type: "png", uri: "u2", id: "2" },
      ],
    };

    const grouped = groupTurns([human, humanFollow]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.attachments).toEqual([
      { name: "a.pdf", size: 1, type: "pdf", uri: "u1", id: "1" },
      { name: "b.png", size: 2, type: "png", uri: "u2", id: "2" },
    ]);
  });

  it("does not merge a same-turn pair that differs in author (user vs assistant)", () => {
    const user: Message = {
      id: "20",
      author: "human",
      content: [{ partId: "20:0", type: "text", text: "q" }],
      turnId: 10,
      createdAt: 100,
    };
    const assistant: Message = {
      id: "21",
      author: "ai",
      content: [{ partId: "21:0", type: "text", text: "a" }],
      turnId: 10,
      createdAt: 200,
    };

    const grouped = groupTurns([user, assistant]);

    expect(grouped).toHaveLength(2);
    expect(grouped.map((m) => m.author)).toEqual(["human", "ai"]);
  });

  it("carries experienceCount from the experience item onto the folded turn", () => {
    const aiPlan: Message = {
      id: "21",
      author: "ai",
      content: [{ partId: "21:0", type: "plan", planId: "10" }],
      turnId: 10,
      createdAt: 200,
    };
    const aiText: Message = {
      id: "24",
      author: "ai",
      content: [{ partId: "24:0", type: "text", text: "done" }],
      turnId: 10,
      createdAt: 300,
    };
    // The experience item (type=8) folds in with its count; it carries no Part.
    const aiExperience: Message = {
      id: "25",
      author: "ai",
      content: [],
      turnId: 10,
      createdAt: 400,
      experienceCount: 2,
    };

    const grouped = groupTurns([aiPlan, aiText, aiExperience]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.experienceCount).toBe(2);
  });

  it("carries experiencePlaybookId from the experience item onto the folded turn", () => {
    const aiPlan: Message = {
      id: "21",
      author: "ai",
      content: [{ partId: "21:0", type: "plan", planId: "10" }],
      turnId: 10,
      createdAt: 200,
    };
    const aiText: Message = {
      id: "24",
      author: "ai",
      content: [{ partId: "24:0", type: "text", text: "done" }],
      turnId: 10,
      createdAt: 300,
    };
    // The experience item (type=8) carries the ACE playbook id that drives the
    // pill's `View more` jump — it must survive the fold or navigation dies.
    const aiExperience: Message = {
      id: "25",
      author: "ai",
      content: [],
      turnId: 10,
      createdAt: 400,
      experienceCount: 2,
      experiencePlaybookId: 77,
    };

    const grouped = groupTurns([aiPlan, aiText, aiExperience]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.experiencePlaybookId).toBe(77);
  });

  it("leaves a turnId-less message (live streaming tail) standalone", () => {
    const tail: Message = {
      id: "live-uuid",
      author: "ai",
      content: [{ partId: "live:0", type: "text", text: "typing…" }],
      streamingState: "streaming",
    };
    const other: Message = {
      id: "live-uuid-2",
      author: "ai",
      content: [],
      streamingState: "streaming",
    };

    const grouped = groupTurns([tail, other]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toBe(tail);
    expect(grouped[1]).toBe(other);
  });

  it("carries a plan row's seedPlan onto the folded turn even when the plan is NOT the first row", () => {
    // The wire usually puts the plan row first, but a preamble/text row can
    // precede it. `use-history` reads `seedPlan` off the GROUPED message, so the
    // fold must carry it regardless of position — else the tree isn't seeded and
    // the card falls back to polling (the exact flash this feature removes).
    const seedPlan: Plan = {
      planId: "10",
      status: PlanStatusSchema.enum.COMPLETED,
      title: "P",
      steps: [],
    };
    const aiText: Message = {
      id: "23",
      author: "ai",
      content: [{ partId: "23:0", type: "text", text: "thinking…" }],
      turnId: 10,
      createdAt: 200,
    };
    const aiPlan: Message = {
      id: "24",
      author: "ai",
      content: [{ partId: "24:0", type: "plan", planId: "10" }],
      turnId: 10,
      createdAt: 300,
      seedPlan,
    };

    const grouped = groupTurns([aiText, aiPlan]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.seedPlan).toBe(seedPlan);
  });
});
