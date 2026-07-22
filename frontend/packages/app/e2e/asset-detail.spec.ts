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

import { expect, test } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

import {
  makeKnowledgeDocument,
  mockEndpoint,
} from "./fixtures/project-fixtures";
import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// E2E for `/project/$projectId/knowledge/$assetId` — the read-only knowledge
// detail. The route owns the Suspense + ErrorBoundary; the resolved detail
// merges `GET /knowledge/document` (the row) with `GET /knowledge/document/
// details` (the body), so BOTH must be mocked. The right panel's tag area
// additionally Suspends on `GET /knowledge/tags`. The row's `status` must be 3
// (INGESTED) or the readiness guard redirects to the project workspace before
// the detail renders.

const ASSET_URL = "/project/1/knowledge/7";

// Mock the two detail reads + the panel's tag list — the trio a loaded detail
// page needs. `status` defaults to INGESTED in `makeKnowledgeDocument`.
async function mockDetailSuccess(
  page: Parameters<typeof mockEndpoint>[0],
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await mockEndpoint(page, "knowledge/document", () => ({
    body: makeOkEnvelope({ document: makeKnowledgeDocument(7, overrides) }),
  }));
  await mockEndpoint(page, "knowledge/document/details", () => ({
    body: makeOkEnvelope({
      summary: "A short summary of the document.",
      fullText: "# Document body\n\nSome content.",
    }),
  }));
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: [], total: 0 }),
  }));
}

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test("renders the knowledge detail panel once loaded", async ({ page }) => {
  await mockDetailSuccess(page, { name: "Quarterly Report" });

  await page.goto(ASSET_URL);
  const panel = page.getByRole("region", { name: "Asset details" });
  await expect(panel).toBeVisible();
  // The name appears twice (article heading + panel); scope to the panel.
  await expect(panel.getByText("Quarterly Report")).toBeVisible();
  await expect(
    page.getByText("A short summary of the document."),
  ).toBeVisible();
});

test("shows the asset skeleton while the detail query is in flight", async ({
  page,
}) => {
  // Delay the document read ~2s so the route's Suspense fallback is observable.
  await mockEndpoint(page, "knowledge/document/details", () => ({
    body: makeOkEnvelope({ summary: "s", fullText: "# b" }),
  }));
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: [], total: 0 }),
  }));
  // Anchored regex (`document?` but never `document/details`) with a 2s delay.
  await page.route(
    /\/api\/sico\/knowledge\/document(?:\?|$)/,
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 2_000);
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          makeOkEnvelope({ document: makeKnowledgeDocument(7) }),
        ),
      });
    },
  );

  await page.goto(ASSET_URL);
  await expect(
    page.getByRole("status", { name: "Loading asset" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Asset details" })).toBeVisible(
    { timeout: 15_000 },
  );
});

test("renders the error view with Try again when the document 500s", async ({
  page,
}) => {
  await mockEndpoint(page, "knowledge/document", () => ({
    status: 500,
    body: { code: 500, msg: "server error", data: {} },
  }));

  await page.goto(ASSET_URL);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
});

test("delete knowledge: confirming surfaces the success toast", async ({
  page,
}) => {
  // One `/knowledge/document` route serves both verbs: a GET (has `id`) returns
  // the row; the DELETE returns an ok envelope. Success navigates back to the
  // overview, so its endpoints are stubbed empty too.
  await mockEndpoint(page, "knowledge/document/details", () => ({
    body: makeOkEnvelope({ summary: "s", fullText: "# b" }),
  }));
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: [], total: 0 }),
  }));
  await mockEndpoint(page, "knowledge/document", (url) =>
    url.searchParams.has("id")
      ? {
          body: makeOkEnvelope({
            document: makeKnowledgeDocument(7, { name: "Stale Doc" }),
          }),
        }
      : { body: makeOkEnvelope({}) },
  );
  await mockEndpoint(page, "project", () => ({
    body: makeOkEnvelope({
      id: 1,
      name: "Acme",
      description: "",
      iconUrl: "",
      memberType: 1,
      agentInstances: [],
      ownerUsername: "o@b.test",
      creatorUsername: "c@b.test",
      operatorAdmins: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  }));
  await mockEndpoint(page, "knowledge/documents", () => ({
    body: makeOkEnvelope({ documents: [], total: 0 }),
  }));
  await mockEndpoint(page, "knowledge/playbooks", () => ({
    body: makeOkEnvelope({ playbooks: [], total: 0 }),
  }));

  await page.goto(ASSET_URL);
  await expect(
    page.getByRole("region", { name: "Asset details" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Asset actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const confirm = page.getByRole("dialog", { name: "Delete Knowledge" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByText('"Stale Doc" was deleted.')).toBeVisible();
});

test("drops only the tag area when the tag source fails", async ({ page }) => {
  // The asset itself loads, but the knowledge-tag source 500s. The tag area's
  // local boundary renders nothing — the rest of the panel must survive.
  await mockEndpoint(page, "knowledge/document", () => ({
    body: makeOkEnvelope({
      document: makeKnowledgeDocument(7, { name: "Quarterly Report" }),
    }),
  }));
  await mockEndpoint(page, "knowledge/document/details", () => ({
    body: makeOkEnvelope({ summary: "A short summary.", fullText: "# Body" }),
  }));
  await mockEndpoint(page, "knowledge/tags", () => ({
    status: 500,
    body: { code: 500, msg: "server error", data: {} },
  }));

  await page.goto(ASSET_URL);

  // The rest of the Detail panel still renders…
  const panel = page.getByRole("region", { name: "Asset details" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Quarterly Report")).toBeVisible();
  // …but the failed tag area shows neither its label nor a page-level error.
  await expect(page.getByText("Knowledge tag")).toBeHidden();
  await expect(page.getByRole("button", { name: "Try again" })).toBeHidden();
});

test("experience detail renders read-only under its project route", async ({
  page,
}) => {
  // Experience playbook nests under its project (`/project/$projectId/experience/
  // $id`). It reads only `/knowledge/playbook/details` ({ content, name }) — no
  // document row, no tags — and renders read-only: Markdown body, a "Back to
  // Projects" bar, and NO right-hand "Asset details" panel or actions menu.
  await mockEndpoint(page, "knowledge/playbook/details", () => ({
    body: makeOkEnvelope({
      content: "# Playbook body\n\nReusable steps here.",
      name: "Reusable Playbook",
    }),
  }));

  await page.goto("/project/5/experience/34");

  // The Markdown body renders.
  await expect(
    page.getByRole("heading", { name: "Playbook body" }),
  ).toBeVisible();
  // Read-only: no Knowledge Detail panel, no per-asset actions.
  await expect(
    page.getByRole("region", { name: "Asset details" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Asset actions" }),
  ).toBeHidden();
});

test("experience Back lands on the owning project when opened via deep-link", async ({
  page,
}) => {
  // Deep-link entry (goto = no in-app history), so Back can't go through history.
  // The projectId is in the route (`$projectId`), so Back navigates straight to
  // `/project/$projectId` — no playbook lookup, mirroring the knowledge detail.
  await mockEndpoint(page, "knowledge/playbook/details", () => ({
    body: makeOkEnvelope({
      content: "# Playbook body\n\nReusable steps here.",
      name: "Reusable Playbook",
    }),
  }));

  await page.goto("/project/5/experience/34");
  await expect(
    page.getByRole("heading", { name: "Playbook body" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();

  // The route's projectId (5) → the project workspace route, no async lookup.
  await expect(page).toHaveURL(/\/project\/5(?:$|[/?])/);
});
