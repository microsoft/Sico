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

import { expect, type Page, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// E2E for `/digital-worker/$agentId/collaboration`: the three agent-detail load
// states (loading / loaded / failed) and the send state machine a user can
// drive from the composer.
//
// SSE constraint: Playwright `route.fulfill` delivers the body atomically — it
// can DELAY before responding but cannot hold an event-stream open and push
// frames one at a time. So the send state that is transient *between frames* —
// the streaming `■` (Stop response) window between `onopen` and `done` — is not
// deterministically observable here; it is covered at the unit level
// (`shared/test/features/chat/services/chat.test.ts`). The states below all are:
// request-pending `↻` (hold the POST in-flight), the rendered reply (atomic
// done frame), the failure toast (HTTP error), and the abort (Stop in-flight).

type AgentFixture = {
  id: number;
  name: string;
  role: string;
  iconUri: string;
};

function makeAgent(id: number, name: string): AgentFixture {
  return { id, name, role: "Role", iconUri: "" };
}

// One SSE wire frame, mirroring the transport's contract (chat-stream.test.ts).
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const AGENT = makeAgent(5, "Chloe");
const COLLAB_URL = "/digital-worker/5/collaboration";
const CHAT_ROUTE = "**/api/sico/conversation/chat";
// SEND_FAILED_COPY in shared/features/chat/services/chat.ts (not exported).
const SEND_FAILED_TOAST = "Something went wrong. Try sending again.";

// Detail (singular) endpoint only. A trailing-`*` glob
// (`single_agent_instance*`) would ALSO swallow the sidebar's plural
// `single_agent_instances?…` list call, so match the literal `?` query
// delimiter — present on the detail GET, absent right after the plural's
// `…instances`.
async function mockAgentDetail(
  page: Page,
  handler: () => { status?: number; body: unknown },
): Promise<void> {
  await page.route(
    /\/api\/sico\/agent\/single_agent_instance\?/,
    async (route) => {
      const { status = 200, body } = handler();
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    },
  );
}

// Hold the chat POST in-flight forever so the request-pending `↻` control stays
// mounted to observe / click. Stop aborts it client-side; teardown discards the
// never-resolved handler (mirrors composer.test.tsx's never-settling upload).
async function hangChatStream(page: Page): Promise<void> {
  await page.route(CHAT_ROUTE, () => new Promise(() => {}));
}

// Resolve agent detail, stub a history page, navigate, and wait for the
// composer so the send-state tests start from a fully-loaded collaboration page.
// History must be stubbed because `useHistory` now suspends (it drives the
// whole-page Suspense fallback alongside agent detail) — without a valid page
// the catch-all `mockSicoApi` returns `{}`, which fails the history schema and
// throws to the ErrorBoundary instead of rendering the composer. Defaults to an
// empty page; tests needing specific history pass it here (registering one route
// — NOT a pre-call to `mockHistory`, which last-registered-first would shadow).
async function loadCollaboration(
  page: Page,
  history: HistoryItem[] = [],
): Promise<void> {
  await mockAgentDetail(page, () => ({
    body: makeOkEnvelope({ instance: AGENT }),
  }));
  await mockHistory(page, history);
  await page.goto(COLLAB_URL);
  await expect(page.getByLabel("Message input")).toBeVisible();
}

// --- history / plan-poll / reconnect fixtures -----------------------------
//
// Three more endpoints back the studio-mode chat Collaboration mounts:
// `GET /conversation/messages` (history hydration), `GET /conversation/plan`
// (the PlanCard's 2s poll), and the reconnect probe (already POSTed on mount via
// CHAT_ROUTE's sibling `/chat/reconnect`). The two GETs are matched by a
// literal-`?` regex — same trick as `mockAgentDetail` — so they bind only their
// query-bearing form and never shadow the defensive `mockSicoApi` catch-all.

// Newest-first MessageItem (msg.proto): type 1 = MARKDOWN, 9 = PLAN. A PLAN item
// is a POINTER (turnId only) — its step rows live behind GET /plan, so the card
// derives `planId = String(turnId)` and polls for the tree.
const MSG_MARKDOWN = 1;
const MSG_PLAN = 9;

// Plan-tree wire enums (conversation/plan.proto), kept numeric like the schema.
const PLAN_RUNNING = 2;
const PLAN_COMPLETED = 3;
const STEP_IN_PROGRESS = 2; // PlanStepStatus — any non-PENDING(1) step renders.
const STEP_COMPLETED = 3;

// §5 reconnect toast copy (use-reconnect.ts RECONNECT_TOAST_COPY, verbatim).
const RECONNECTING_TOAST = "Reconnecting…";

type HistoryItem = {
  messageId: number;
  turnId: number;
  role: "user" | "assistant";
  type: number;
  content?: string;
};

// Stub one history page (newest-first, no older pages).
async function mockHistory(page: Page, items: HistoryItem[]): Promise<void> {
  await page.route(/\/conversation\/messages\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(makeOkEnvelope({ messages: items, hasMore: false })),
    });
  });
}

type PlanStepWire = { title: string; status: number };

// The wire GetPlanData: a sibling `status` + a `plan` whose `extra.turnId` IS
// the plan id and whose `steps` are the rows.
function planEnvelope(
  turnId: number,
  status: number,
  steps: PlanStepWire[],
): unknown {
  return makeOkEnvelope({ status, plan: { extra: { turnId }, steps } });
}

// Stub the PlanCard poll. `handler` runs per tick, so a test can return a
// different tree each call (RUNNING then COMPLETED drives the collapse edge).
// `\/plan\?` excludes the POST `/plan/cancel` (no query string).
async function mockPlan(page: Page, handler: () => unknown): Promise<void> {
  await page.route(/\/conversation\/plan\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(handler()),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test.describe("collaboration load states", () => {
  test("shows the header skeleton while agent detail is in flight", async ({
    page,
  }) => {
    // Delay agent detail so the Header's own Suspense fallback (HeaderSkeleton)
    // is observable. The Header loads INDEPENDENTLY of history now, so only the
    // header strip is a skeleton — the message area + composer mount in parallel.
    await page.route(
      /\/api\/sico\/agent\/single_agent_instance\?/,
      async (route) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 2_000);
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(makeOkEnvelope({ instance: AGENT })),
        });
      },
    );
    await mockHistory(page, []);

    await page.goto(COLLAB_URL);
    // The header skeleton is up while agent detail loads…
    await expect(page.getByTestId("header-skeleton")).toBeVisible();
    // …then the real header (back link) replaces it once detail resolves.
    await expect(
      page.getByRole("link", { name: "Back to Digital Workers" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows a message-area spinner while history loads, keeping header + composer", async ({
    page,
  }) => {
    // Agent detail resolves immediately; history is delayed. Because history now
    // suspends behind an INNER boundary (only the message area), the Header and
    // Composer stay mounted while a spinner sits over the message list.
    await mockAgentDetail(page, () => ({
      body: makeOkEnvelope({ instance: AGENT }),
    }));
    await page.route(/\/conversation\/messages\?/, async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeOkEnvelope({ messages: [], hasMore: false })),
      });
    });

    await page.goto(COLLAB_URL);
    // Header + composer are present DURING history load (not gated by it)…
    await expect(
      page.getByRole("link", { name: "Back to Digital Workers" }),
    ).toBeVisible();
    await expect(page.getByLabel("Message input")).toBeVisible();
    // …and the message area shows its own spinner meanwhile.
    await expect(
      page.getByRole("status", { name: "Loading", exact: true }),
    ).toBeVisible();
  });

  test("renders the header and composer once agent detail resolves", async ({
    page,
  }) => {
    await loadCollaboration(page);

    await expect(
      page.getByRole("link", { name: "Back to Digital Workers" }),
    ).toBeVisible();
    // The name span is a leaf (role lives in a sibling span); exact pins it.
    await expect(page.getByText("Chloe", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Message input")).toBeVisible();
  });

  test("renders the error view with Try again on detail 500", async ({
    page,
  }) => {
    await mockAgentDetail(page, () => ({
      status: 500,
      body: { code: 500, msg: "server error", data: {} },
    }));

    await page.goto(COLLAB_URL);
    // The suspense query retries 3× with exp backoff before throwing to the
    // ErrorBoundary, so allow more than the default 5s assertion timeout.
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("message send states", () => {
  test("shows the request-pending control while the send is in flight", async ({
    page,
  }) => {
    await loadCollaboration(page);
    await hangChatStream(page);

    await page.getByLabel("Message input").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(
      page.getByRole("button", { name: "Stop request" }),
    ).toBeVisible();
    // The human message is echoed optimistically on click.
    await expect(page.getByText("hello")).toBeVisible();
  });

  test("renders the streamed assistant reply on a successful send", async ({
    page,
  }) => {
    await loadCollaboration(page);
    await page.route(CHAT_ROUTE, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body:
          sseFrame("message", { type: 1, content: "Hi there" }) +
          sseFrame("done", { timestamp: 1 }),
      });
    });

    await page.getByLabel("Message input").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("hello")).toBeVisible();
    await expect(page.getByText("Hi there")).toBeVisible();
  });

  test("surfaces a failure toast when the send returns an HTTP error", async ({
    page,
  }) => {
    await loadCollaboration(page);
    await page.route(CHAT_ROUTE, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: 500, msg: "server error" }),
      });
    });

    await page.getByLabel("Message input").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText(SEND_FAILED_TOAST)).toBeVisible();
    // The human message is kept so the user can retry.
    await expect(page.getByText("hello")).toBeVisible();
  });

  test("cancels the in-flight send when Stop request is clicked", async ({
    page,
  }) => {
    await loadCollaboration(page);
    await hangChatStream(page);

    await page.getByLabel("Message input").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    const stop = page.getByRole("button", { name: "Stop request" });
    await expect(stop).toBeVisible();
    await stop.click();

    // Abort resolves the turn silently → the pending control unmounts and the
    // composer falls back to idle, but the human message stays.
    await expect(stop).toBeHidden();
    await expect(page.getByText("hello")).toBeVisible();
  });
});

test.describe("history + plan + reconnect", () => {
  test("hydrates and renders a history page on mount", async ({ page }) => {
    // Newest-first wire page (history reverses to oldest→newest for render). A
    // user + an assistant MARKDOWN turn prove both bubbles hydrate from
    // `GET /conversation/messages` into the store the list renders off.
    await loadCollaboration(page, [
      {
        messageId: 2,
        turnId: 2,
        role: "assistant",
        type: MSG_MARKDOWN,
        content: "Earlier answer",
      },
      {
        messageId: 1,
        turnId: 1,
        role: "user",
        type: MSG_MARKDOWN,
        content: "Earlier question",
      },
    ]);

    await expect(page.getByText("Earlier question")).toBeVisible();
    await expect(page.getByText("Earlier answer")).toBeVisible();
  });

  test("polls a history plan, fills its rows, then auto-collapses on completion", async ({
    page,
  }) => {
    // The plan card can only fill from the HISTORY path: a history PLAN turn
    // carries no `streamingState`, so `usePlan`'s mount guard (`isTurnTerminal`)
    // lets the 2 s poll run. (A *sent* turn goes terminal on the atomic `done`
    // frame before the poll's first tick, so the guard would skip it — the send
    // path can't drive this.) A PLAN item is a pointer (turnId only); the card
    // derives `planId = String(turnId)` and owns the `/plan` fetch.
    const planHistory: HistoryItem[] = [
      { messageId: 1, turnId: 7, role: "assistant", type: MSG_PLAN },
    ];
    // Tick 1 RUNNING (seeds expanded → rows show); tick 2 COMPLETED drives the
    // RUNNING→terminal edge (auto-collapse) and self-stops the poll.
    let polls = 0;
    await mockPlan(page, () => {
      polls += 1;
      return polls === 1
        ? planEnvelope(7, PLAN_RUNNING, [
            { title: "Crawl the dataset", status: STEP_IN_PROGRESS },
          ])
        : planEnvelope(7, PLAN_COMPLETED, [
            { title: "Crawl the dataset", status: STEP_COMPLETED },
          ]);
    });
    await loadCollaboration(page, planHistory);

    // Fill: the first poll renders the step row inside the expanded card.
    await expect(page.getByText("Crawl the dataset")).toBeVisible({
      timeout: 10_000,
    });
    // Completion: the terminal poll flips the header copy …
    await expect(page.getByText("Execution completed")).toBeVisible({
      timeout: 10_000,
    });
    // … and auto-collapses the body, so the step row unmounts.
    await expect(page.getByText("Crawl the dataset")).toBeHidden();
  });

  test("raises the Reconnecting toast on an SSE drop, then clears it on resume", async ({
    page,
  }) => {
    // Drive the reconnect machine through one drop→resume arc. Attempt 1 opens,
    // pushes a `message` frame carrying `turnId` (sets `activeTurnId`), then the
    // atomic body ends → close → the toast fires (a live turn was observed).
    // Attempt 2 (after backoff) returns a terminal `done` frame → the machine
    // exits to idle and dismisses the toast — the "resume".
    let attempts = 0;
    await page.route(/\/conversation\/chat\/reconnect/, async (route) => {
      attempts += 1;
      const body =
        attempts === 1
          ? sseFrame("message", {
              type: MSG_MARKDOWN,
              content: "resuming",
              turnId: 7,
            })
          : sseFrame("done", { timestamp: 1 });
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });
    await loadCollaboration(page);

    await expect(page.getByText(RECONNECTING_TOAST)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(RECONNECTING_TOAST)).toBeHidden({
      timeout: 10_000,
    });
  });

  test("replays the resumed turn's content into history on reconnect (issue #191)", async ({
    page,
  }) => {
    // Issue #191 acceptance: a reconnect must re-render the RESUMED TURN'S
    // CONTENT, not just the banner. The reconnect stream pushes from-head frames
    // for the in-flight turn; `onReplay` (wired in Collaboration) looks the turn
    // up by turnId and reset-then-replays into history.
    //
    // Because reconnect probes IN PARALLEL with history (both key off the URL
    // agentInstanceId, and history suspends behind an inner boundary so
    // Collaboration's reconnect effect still runs on mount), the replay frames
    // can arrive BEFORE history hydrates the turn. The handler must buffer the
    // run and flush it once the turn appears — this test exercises exactly that
    // race (no artificial delay).
    //
    // Setup: history carries an assistant turn (turnId 7) whose visible text is
    // a STALE partial ("partial repl") — the turn the user was mid-stream on when
    // the socket dropped. The reconnect stream replays the FULL from-head run, so
    // the message must rebuild to the complete text.
    await page.route(/\/conversation\/chat\/reconnect/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        // From-head replay of turn 7: the full text the backend resumes with.
        body:
          sseFrame("message", {
            type: MSG_MARKDOWN,
            content: "partial reply, now complete",
            turnId: 7,
          }) + sseFrame("done", { timestamp: 1 }),
      });
    });
    await loadCollaboration(page, [
      {
        messageId: 70,
        turnId: 7,
        role: "assistant",
        type: MSG_MARKDOWN,
        content: "partial repl",
      },
    ]);

    // The reconnect replay rebuilds the turn to its full content — proving the
    // resumed turn re-renders, not just the banner (issue #191 acceptance).
    await expect(page.getByText("partial reply, now complete")).toBeVisible({
      timeout: 10_000,
    });
  });
});
