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

import { type Page } from "@playwright/test";
import { makeOkEnvelope } from "@sico/shared/schemas/api.ts";

// mockSicoApi answers {} for every route, failing typed endpoints' zod parse;
// these factories supply valid envelopes to override per test.

const NOW = 1_700_000_000;

// memberType 1 = OWNER (shows the drawer's "Edit project" affordance).
export function makeProjectDetail(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: `Project ${String(id)}`,
    description: `Description for project ${String(id)}`,
    iconUrl: "",
    memberType: 1,
    agentInstances: [],
    ownerUsername: "owner@b.test",
    creatorUsername: "creator@b.test",
    operatorAdmins: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// status 3 = INGESTED (passes the asset-detail readiness guard); type 1 = FILE.
export function makeKnowledgeDocument(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: `Knowledge ${String(id)}`,
    documentType: 1,
    status: 3,
    tags: [],
    creatorUsername: "creator@b.test",
    createdAt: NOW,
    sourceFile: `knowledge-${String(id)}.pdf`,
    ...overrides,
  };
}

// "When to use" maps to `description`.
export function makeKnowledgeTag(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    projectId: 1,
    name: `Knowledge tag ${String(id)}`,
    description: `When to use knowledge tag ${String(id)}`,
    creatorUsername: "creator@b.test",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type RouteBody = { status?: number; body: unknown };

// Anchor the endpoint (followed by `?` or end) so `knowledge/tag` isn't
// swallowed by `knowledge/tags`. Most-recently-registered wins over mockSicoApi.
export async function mockEndpoint(
  page: Page,
  endpoint: string,
  handler: (url: URL) => RouteBody,
): Promise<void> {
  const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`/api/sico/${escaped}(?:\\?|$)`);
  await page.route(pattern, async (route) => {
    const { status = 200, body } = handler(new URL(route.request().url()));
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

// An Experience playbook wire row — the authoring DW's name + icon ride in
// `extraInfo.agentInstance`.
export function makePlaybook(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: `Playbook ${String(id)}`,
    projectId: 1,
    agentInstanceId: 42,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    extraInfo: { agentInstance: { agentName: "Max", agentIconUrl: "" } },
    ...overrides,
  };
}

// A Deliverable wire row (`fileName` → client `name`); creator is the authoring
// DW. `fileSasUrl` is the published file the row opens in a new tab.
export function makeDeliverable(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    projectId: 1,
    fileName: `Deliverable ${String(id)}.pdf`,
    fileSasUrl: `https://sas.example.test/deliverable-${String(id)}.pdf`,
    agentInstanceId: 42,
    createdAt: NOW,
    updatedAt: NOW,
    extraInfo: { agentInstance: { agentName: "Max", agentIconUrl: "" } },
    ...overrides,
  };
}

// The unified `/knowledge/items` mixed list — each row wrapped in its
// type-discriminated envelope (1 = document, 2 = playbook, 3 = deliverable), the
// shape the `all` tab consumes.
function toKnowledgeItems(
  documents: Record<string, unknown>[],
  playbooks: Record<string, unknown>[],
  deliverables: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [
    ...documents.map((document) => ({ type: 1, document })),
    ...playbooks.map((playbook) => ({ type: 2, playbook })),
    ...deliverables.map((deliverable) => ({ type: 3, deliverable })),
  ];
}

// Mock EVERY per-category list endpoint the migrated workspace can hit, so any
// category route (`/project/1`, `/knowledge`, `/deliverable`, `/experience`)
// resolves its suspense rows from a typed success envelope instead of the
// `mockSicoApi` catch-all `{}` (which fails the parse → error view). The `all`
// tab's `/knowledge/items` is the mixed list; the three per-type endpoints back
// the sibling category routes.
export async function mockWorkspaceSuccess(
  page: Page,
  options: {
    project?: Record<string, unknown>;
    knowledgeTags?: Record<string, unknown>[];
    documents?: Record<string, unknown>[];
    playbooks?: Record<string, unknown>[];
    deliverables?: Record<string, unknown>[];
  } = {},
): Promise<void> {
  const project = makeProjectDetail(1, options.project ?? {});
  const knowledgeTags = options.knowledgeTags ?? [makeKnowledgeTag(1)];
  const documents = options.documents ?? [makeKnowledgeDocument(1)];
  const playbooks = options.playbooks ?? [];
  const deliverables = options.deliverables ?? [];
  const items = toKnowledgeItems(documents, playbooks, deliverables);

  await mockEndpoint(page, "project", () => ({
    body: makeOkEnvelope({ ...project }),
  }));
  await mockEndpoint(page, "knowledge/tags", () => ({
    body: makeOkEnvelope({ tags: knowledgeTags, total: knowledgeTags.length }),
  }));
  // `all` tab — the mixed unified list.
  await mockEndpoint(page, "knowledge/items", () => ({
    body: makeOkEnvelope({ items, total: items.length, hasNext: false }),
  }));
  // Knowledge tab.
  await mockEndpoint(page, "knowledge/documents", () => ({
    body: makeOkEnvelope({
      documents,
      total: documents.length,
      hasNext: false,
    }),
  }));
  // Experience tab.
  await mockEndpoint(page, "knowledge/playbooks", () => ({
    body: makeOkEnvelope({
      playbooks,
      total: playbooks.length,
      hasNext: false,
    }),
  }));
  // Deliverable tab — note the backend's `hasMore` (not `hasNext`).
  await mockEndpoint(page, "project/deliverables", () => ({
    body: makeOkEnvelope({
      deliverables,
      total: deliverables.length,
      hasMore: false,
    }),
  }));
}
