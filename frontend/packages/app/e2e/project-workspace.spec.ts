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
  makeDeliverable,
  makeKnowledgeDocument,
  makePlaybook,
  makeProjectDetail,
  mockEndpoint,
  mockWorkspaceSuccess,
} from "./fixtures/project-fixtures";
import { mockSicoApi, seedAuth } from "./fixtures/seed-auth";

// E2E for `/project/$projectId` — the workspace shell (project index route). It
// Suspends on TWO queries (project detail + knowledge tags). The assets table
// below is now a SUSPENSE pair too: each category route (`all` / `knowledge` /
// `deliverable` / `experience`) reads its own paginated endpoint via
// `useSuspenseAssetsInfiniteQuery`, prefetched in the route loader. A cold load
// suspends to the bare skeleton; a failed list throws to the in-card ErrorView;
// the toolbar + scroll card + infinite-scroll sentinel stay mounted across every
// state. Because the `mockSicoApi` catch-all returns `{}` (which fails every
// typed parse), each success/empty test mocks ALL category endpoints via
// `mockWorkspaceSuccess`.

const OVERVIEW_URL = "/project/1";

test.beforeEach(async ({ page }) => {
  await seedAuth(page);
  await mockSicoApi(page);
});

test("renders the project name and assets toolbar once loaded", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page, {
    project: { id: 1, name: "Acme Workspace" },
  });

  await page.goto(OVERVIEW_URL);
  await expect(
    page.getByRole("heading", { level: 1, name: "Acme Workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add Knowledge" }),
  ).toBeVisible();
  // The right drawer renders the project-details rail.
  await expect(
    page.getByRole("region", { name: "Project details" }),
  ).toBeVisible();
});

test("a direct page load of /project/$id shows the full-page skeleton until the project resolves", async ({
  page,
}) => {
  // `page.goto` is a cold/hard load — the SPA boots from scratch, runs the route
  // loader, and renders first paint (i.e. a browser refresh or external deep-link
  // into the URL, NOT an in-app soft navigation). Delaying project detail ~2s
  // keeps the workspace Suspense fallback (`ProjectWorkspaceSkeleton`) observable
  // so a refresh provably shows the full-page loading state before data lands.
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: [], total: 0 }),
  }));
  await page.route("**/api/sico/project*", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeOkEnvelope({
          id: 1,
          name: "Acme Workspace",
          description: "",
          iconUrl: "",
          memberType: 1,
          agentInstances: [],
          ownerUsername: "owner@b.test",
          creatorUsername: "creator@b.test",
          operatorAdmins: [],
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000,
        }),
      ),
    });
  });

  await page.goto(OVERVIEW_URL);
  await expect(
    page.getByRole("status", { name: "Loading project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Acme Workspace" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("a direct page load of a category sub-route (/knowledge) shows the same full-page skeleton", async ({
  page,
}) => {
  // The migration split each category onto its own route, each with its own
  // loader. A hard load (refresh / deep-link) of a SUB-route must show the same
  // workspace skeleton as the index route — it is the same `ProjectWorkspace`
  // shell suspending on project detail, just reached via `/knowledge`.
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: [], total: 0 }),
  }));
  await page.route("**/api/sico/project*", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeOkEnvelope(makeProjectDetail(1, { name: "Acme Workspace" })),
      ),
    });
  });

  await page.goto(`${OVERVIEW_URL}/knowledge`);
  await expect(
    page.getByRole("status", { name: "Loading project" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Acme Workspace" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("a direct page load shows the in-table skeleton once the shell is up but rows are still loading", async ({
  page,
}) => {
  // The most common refresh frame: render-as-you-fetch means the loader
  // prefetches project detail AND the asset list in parallel. Detail is small
  // and resolves first, so the SHELL paints immediately (real title, real
  // drawer) — the full-page `ProjectWorkspaceSkeleton` is gone. Only the slower
  // asset list is still in flight, so the table body holds the BARE in-card
  // skeleton (the C1/C2 + local-Suspense design). This is the state seen on a
  // hard refresh of `/project/1`, NOT a full-page skeleton.
  await mockWorkspaceSuccess(page, {
    project: { name: "Acme Workspace" },
  });
  // Delay ONLY the `all` list endpoint so the rows stay suspended while the
  // shell (driven by the already-resolved detail query) is fully painted.
  await page.route("**/api/sico/knowledge/items*", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeOkEnvelope({ items: [], total: 0, hasNext: false }),
      ),
    });
  });

  await page.goto(OVERVIEW_URL);

  // The shell is already up: the real title + the toolbar tabs are painted…
  await expect(
    page.getByRole("heading", { level: 1, name: "Acme Workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
  // …while the asset table body is still the in-card skeleton (bare rows).
  await expect(
    page.getByTestId("assets-table-skeleton-row").first(),
  ).toBeVisible();
});

test("renders the full-page error view with Try again when project detail 500s", async ({
  page,
}) => {
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: [], total: 0 }),
  }));
  await mockEndpoint(page, "project", () => ({
    status: 500,
    body: { code: 500, msg: "server error", data: {} },
  }));

  await page.goto(OVERVIEW_URL);
  // Suspense query retries 3× with exp backoff before throwing to the boundary.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
});

test("renders the assets empty state when the category list is empty", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page, { documents: [] });

  await page.goto(OVERVIEW_URL);
  await expect(
    page.getByRole("heading", { level: 2, name: "No assets yet" }),
  ).toBeVisible();
});

test("renders an in-table error view when the assets list 500s", async ({
  page,
}) => {
  // Suspense queries succeed (so the shell mounts), but the `all` category's
  // unified list fails — it throws to the LOCAL in-card ErrorBoundary while the
  // toolbar + tabs stay put.
  await mockWorkspaceSuccess(page);
  await mockEndpoint(page, "knowledge/items", () => ({
    status: 500,
    body: { code: 500, msg: "server error", data: {} },
  }));

  await page.goto(OVERVIEW_URL);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 15_000,
  });
});

test("Add Knowledge: a link import surfaces the success toast", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page);
  // The link registers a LINK document; the dialog toasts + closes on success.
  await mockEndpoint(page, "knowledge/document", () => ({
    body: makeOkEnvelope({ id: 99 }),
  }));

  await page.goto(OVERVIEW_URL);
  await page.getByRole("button", { name: "Add Knowledge" }).click();

  const dialog = page.getByRole("dialog", { name: "Add Knowledge" });
  await expect(dialog).toBeVisible();

  await dialog
    .getByLabel("Import from link")
    .fill("https://example.com/doc.pdf");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  // The attachment chip confirms the link is staged before upload.
  await expect(dialog.getByText("https://example.com/doc.pdf")).toBeVisible();

  await dialog.getByRole("button", { name: "Upload" }).click();
  // Success surfaces the "uploaded, now extracting" toast; the final ingest
  // result toast comes later from the table poll.
  await expect(
    page.getByText("Knowledge uploaded — extracting…"),
  ).toBeVisible();
});

test("navigating to a knowledge row opens its detail page", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page, {
    documents: [makeKnowledgeDocument(7, { name: "Onboarding Guide" })],
  });
  // Detail page reads the singular document + its body.
  await mockEndpoint(page, "knowledge/document", () => ({
    body: makeOkEnvelope({ document: makeKnowledgeDocument(7) }),
  }));
  await mockEndpoint(page, "knowledge/document/details", () => ({
    body: makeOkEnvelope({ summary: "A short summary", fullText: "# Body" }),
  }));

  await page.goto(OVERVIEW_URL);
  await page.getByText("Onboarding Guide").click();
  await expect(page).toHaveURL(/\/project\/1\/knowledge\/7$/);
});

// The next four cover assets-table interactions END-TO-END: the unit tests
// verify onSearchChange fires, but only e2e proves the change round-trips
// through the URL and the table re-renders the filtered/sorted rows.

test("the Experience tab is a route link that loads only playbook rows", async ({
  page,
}) => {
  // The category is now the route PATH (not a `?tab=` param). The mixed `all`
  // list shows both a doc + a playbook; the Experience tab navigates to
  // `/project/1/experience`, whose endpoint returns only playbooks.
  await mockWorkspaceSuccess(page, {
    documents: [makeKnowledgeDocument(1, { name: "A Knowledge Doc" })],
    playbooks: [makePlaybook(2, { name: "A Playbook" })],
  });

  await page.goto(OVERVIEW_URL);
  // The All tab shows both the doc and the playbook.
  await expect(page.getByText("A Knowledge Doc")).toBeVisible();
  await expect(page.getByText("A Playbook")).toBeVisible();

  await page.getByRole("tab", { name: "Experience" }).click();

  // Category rides in the path now, not `?tab=`.
  await expect(page).toHaveURL(/\/project\/1\/experience$/);
  await expect(page.getByText("A Playbook")).toBeVisible();
  await expect(page.getByText("A Knowledge Doc")).toBeHidden();
});

test("the Deliverable tab is a route link that loads only deliverable rows", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page, {
    documents: [makeKnowledgeDocument(1, { name: "A Knowledge Doc" })],
    deliverables: [makeDeliverable(3, { fileName: "Q4 Report.pdf" })],
  });

  await page.goto(OVERVIEW_URL);
  await page.getByRole("tab", { name: "Deliverable" }).click();

  await expect(page).toHaveURL(/\/project\/1\/deliverable$/);
  await expect(page.getByText("Q4 Report.pdf")).toBeVisible();
  await expect(page.getByText("A Knowledge Doc")).toBeHidden();
});

test("a direct page load of /experience selects the Experience tab and loads its rows", async ({
  page,
}) => {
  // The migration drives the active category from the route PATH, so a hard load
  // (refresh / deep-link) straight into a sub-route must mark the matching tab
  // selected and render only that category's rows — without ever visiting `all`.
  await mockWorkspaceSuccess(page, {
    documents: [makeKnowledgeDocument(1, { name: "A Knowledge Doc" })],
    playbooks: [makePlaybook(2, { name: "A Playbook" })],
  });

  await page.goto(`${OVERVIEW_URL}/experience`);

  // The Experience tab is the selected one straight from the cold URL.
  await expect(
    page.getByRole("tab", { name: "Experience", selected: true }),
  ).toBeVisible();
  // Only the playbook resolves; the doc never loads on this route.
  await expect(page.getByText("A Playbook")).toBeVisible();
  await expect(page.getByText("A Knowledge Doc")).toBeHidden();
});

test("searching filters rows and syncs ?q to the URL", async ({ page }) => {
  await mockWorkspaceSuccess(page, {
    documents: [
      makeKnowledgeDocument(1, { name: "Quarterly Report" }),
      makeKnowledgeDocument(2, { name: "Onboarding Guide" }),
    ],
  });

  await page.goto(OVERVIEW_URL);
  await expect(page.getByText("Quarterly Report")).toBeVisible();
  await expect(page.getByText("Onboarding Guide")).toBeVisible();

  // The 🔍 collapses to an icon button; click expands the field.
  await page.getByRole("button", { name: "Search assets" }).click();
  await page.getByPlaceholder("Search assets").fill("Quarterly");

  await expect(page).toHaveURL(/[?&]q=Quarterly/);
  await expect(page.getByText("Quarterly Report")).toBeVisible();
  await expect(page.getByText("Onboarding Guide")).toBeHidden();
});

test("toggling the CREATED TIME header flips the sort and syncs ?sort", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page, {
    documents: [makeKnowledgeDocument(1, { name: "Only Doc" })],
  });

  await page.goto(OVERVIEW_URL);
  // Default sort is desc, which the route omits from the URL (clean default).
  // Toggling to asc adds ?sort=asc; toggling back drops it again.
  const sortHeader = page.getByRole("button", { name: /CREATED TIME/i });
  await sortHeader.click();
  await expect(page).toHaveURL(/[?&]sort=asc/);
  await sortHeader.click();
  await expect(page).not.toHaveURL(/sort=asc/);
});

test("collapsing the drawer hides it and the restore button brings it back", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page);

  await page.goto(OVERVIEW_URL);
  const drawer = page.getByRole("region", { name: "Project details" });
  await expect(drawer).toBeVisible();

  // Collapse: the drawer unmounts and a restore button appears in the header.
  await page.getByRole("button", { name: "Collapse panel" }).click();
  await expect(drawer).toBeHidden();

  // Restore re-mounts the drawer.
  await page.getByRole("button", { name: "Project details" }).click();
  await expect(drawer).toBeVisible();
});

test("editing the project from the drawer toasts and closes on success", async ({
  page,
}) => {
  await mockWorkspaceSuccess(page, { project: { name: "Acme" } });
  // PUT /project returns the updated id; the dialog toasts + closes on success.
  await mockEndpoint(page, "project", (url) =>
    url.searchParams.has("id")
      ? { body: makeOkEnvelope({ ...makeProjectDetail(1, { name: "Acme" }) }) }
      : { body: makeOkEnvelope({ id: 1 }) },
  );

  await page.goto(OVERVIEW_URL);
  await page.getByRole("button", { name: "Edit project" }).click();

  const dialog = page.getByRole("dialog", { name: "Edit project" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Acme Renamed");
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Your changes are saved.")).toBeVisible();
  await expect(dialog).toBeHidden();
});
