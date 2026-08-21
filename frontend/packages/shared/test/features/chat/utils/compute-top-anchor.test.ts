import { describe, expect, it } from "vitest";

import {
  ANCHOR_OFFSET_PX,
  computeReserveHeight,
  computeTargetScrollTop,
} from "@/features/chat/utils/compute-top-anchor";

describe("computeTargetScrollTop", () => {
  it("pins a short message to the top minus the breathing offset", () => {
    // A message shorter than the over-scroll threshold scrolls fully into view:
    // target is just its offsetTop minus the 16px breathing room.
    const target = computeTargetScrollTop({
      anchorTop: 800,
      anchorHeight: 60,
      tallerThan: 400,
      visibleHeight: 400,
    });
    expect(target).toBe(800 - ANCHOR_OFFSET_PX);
  });

  it("over-scrolls a message taller than the threshold so only visibleHeight stays on screen", () => {
    // A 900px question is taller than tallerThan(400) → over-scroll by
    // (900 - visibleHeight). Only `visibleHeight` of it remains, leaving room
    // for the reply.
    const target = computeTargetScrollTop({
      anchorTop: 1000,
      anchorHeight: 900,
      tallerThan: 400,
      visibleHeight: 400,
    });
    // anchorTop - 16 + (900 - 400)
    expect(target).toBe(1000 - ANCHOR_OFFSET_PX + 500);
  });

  it("never returns a negative scroll position", () => {
    // The very first message (offsetTop near 0) can't scroll above the top edge.
    const target = computeTargetScrollTop({
      anchorTop: 4,
      anchorHeight: 60,
      tallerThan: 400,
      visibleHeight: 400,
    });
    expect(target).toBe(0);
  });
});

describe("computeReserveHeight", () => {
  // Reserve = target + client + 72px relock-cushion − content.
  it("fills the gap below so the target scroll position is reachable", () => {
    const reserve = computeReserveHeight({
      targetScrollTop: 800,
      clientHeight: 600,
      scrollHeight: 900,
    });
    expect(reserve).toBe(800 + 600 + 72 - 900);
  });

  it("shrinks to 0 once the content is tall enough (incl. cushion)", () => {
    // content 2000 exceeds target+client+cushion (1472) → no filler.
    const reserve = computeReserveHeight({
      targetScrollTop: 800,
      clientHeight: 600,
      scrollHeight: 2000,
    });
    expect(reserve).toBe(0);
  });

  it("reserves the shortfall plus the relock cushion", () => {
    const reserve = computeReserveHeight({
      targetScrollTop: 800,
      clientHeight: 600,
      scrollHeight: 1000,
    });
    expect(reserve).toBe(800 + 600 + 72 - 1000);
  });

  it("keeps the pinned view clear of stick-to-bottom's ~70px relock band", () => {
    // With an empty reply, content ≈ target+anchor; the cushion must put the
    // pin's distance-from-bottom above 70px so the library never relocks.
    const target = 800;
    const client = 600;
    const content = target + 60; // pinned question, no reply yet
    const reserve = computeReserveHeight({
      targetScrollTop: target,
      clientHeight: client,
      scrollHeight: content,
    });
    const scrollHeight = content + reserve;
    const distFromBottom = scrollHeight - client - target;
    expect(distFromBottom).toBeGreaterThan(70);
  });
});
