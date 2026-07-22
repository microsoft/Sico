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

import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import { type Paged } from "../../../schemas/paginated";
import {
  type DeliverableWire,
  deliverableWireSchema,
  type DocumentDetails,
  documentDetailsSchema,
  type KnowledgeDocument,
  knowledgeDocumentWireSchema,
  knowledgeItemsDataSchema,
  type PlaybookDetails,
  playbookDetailsSchema,
  type PlaybookWire,
  playbookWireSchema,
} from "../schemas/asset";
import type { AssetRow } from "../types";
import {
  deliverableToRow,
  documentToRow,
  knowledgeItemToRow,
  playbookToRow,
} from "../utils/asset-row-mappers";

// WIRE-SHAPE: the unified knowledge list — one mixed array of items
// discriminated by `type` (document/playbook/deliverable), replacing the
// separate documents + playbooks loads. Envelope `data.{ items, total,
// hasNext }`; the `.transform` maps the mixed items to client `AssetRow`s.
const knowledgeItemsEnvelope = apiResponseSchema(
  knowledgeItemsDataSchema.transform(
    ({ items, total, hasNext }): Paged<AssetRow> => ({
      items: items.map(knowledgeItemToRow),
      total,
      hasNext: hasNext ?? false,
    }),
  ),
);

// WIRE-SHAPE: the singular endpoint nests the doc under a `document` key
// (mirrors the plural `documents` on the list). Parse the wrapper, then unwrap.
const documentEnvelope = apiResponseSchema(
  z.object({ document: knowledgeDocumentWireSchema }),
);
// The single-playbook endpoint nests the row under a `playbook` key (mirrors the
// plural `playbooks` on the list), reusing the same wire row schema — the ONLY
// source of `projectId` for the top-level playbook detail page (the `/details`
// body carries just `{ content, name }`). The single endpoint omits `extraInfo`,
// which `playbookWireSchema` allows (it is optional).
const playbookEnvelope = apiResponseSchema(
  z.object({ playbook: playbookWireSchema }),
);
// Single deliverable (`GET /project/deliverable?id=`) — the detail page reads
// `fileSasUrl` + `fileName` straight off the wire row (no client-row rename, the
// FilePreview renders the SAS url directly).
const deliverableEnvelope = apiResponseSchema(
  z.object({ deliverable: deliverableWireSchema }),
);
const documentDetailsEnvelope = apiResponseSchema(documentDetailsSchema);
const playbookDetailsEnvelope = apiResponseSchema(playbookDetailsSchema);

type ListParams = {
  projectId: number;
  page: number;
  pageSize: number;
};

// The unified knowledge list (`all` tab). The envelope maps the mixed wire
// items to client `AssetRow`s; `hasNext` drives the infinite-scroll pagination.
export async function fetchKnowledgeItems(
  apiClient: AxiosInstance,
  { projectId, page, pageSize }: ListParams,
): Promise<Paged<AssetRow>> {
  const response = await apiClient.get<unknown>("/knowledge/items", {
    params: { projectId, page, pageSize },
  });
  const parsed = knowledgeItemsEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchKnowledgeItems");
}

// PER-TYPE LIST ENDPOINTS — one paginated source per tab (Knowledge /
// Deliverable / Experience). Each envelope `.transform` renames its wire
// list-key → `items`, normalizes `hasNext`, AND maps its wire rows to client
// `AssetRow`s — so every list fetcher returns `Paged<AssetRow>`, the single
// wire→client boundary. `/knowledge/{documents,playbooks}` carry `hasNext`;
// `/project/deliverables` carries `hasMore`, renamed here (mirrors
// `chat/services/history.ts`).
const documentsEnvelope = apiResponseSchema(
  z
    .object({
      documents: z.array(knowledgeDocumentWireSchema),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean().nullish(),
    })
    .transform(
      ({ documents, total, hasNext }): Paged<AssetRow> => ({
        items: documents.map(documentToRow),
        total,
        hasNext: hasNext ?? false,
      }),
    ),
);

const playbooksEnvelope = apiResponseSchema(
  z
    .object({
      playbooks: z.array(playbookWireSchema),
      total: z.number().int().nonnegative(),
      hasNext: z.boolean().nullish(),
    })
    .transform(
      ({ playbooks, total, hasNext }): Paged<AssetRow> => ({
        items: playbooks.map(playbookToRow),
        total,
        hasNext: hasNext ?? false,
      }),
    ),
);

const deliverablesEnvelope = apiResponseSchema(
  z
    .object({
      deliverables: z.array(deliverableWireSchema),
      total: z.number().int().nonnegative(),
      // Backend sends `hasMore` here (NOT `hasNext` like the other lists).
      hasMore: z.boolean().nullish(),
    })
    .transform(
      ({ deliverables, total, hasMore }): Paged<AssetRow> => ({
        items: deliverables.map(deliverableToRow),
        total,
        hasNext: hasMore ?? false,
      }),
    ),
);

// Knowledge tab — paginated documents. Creator is a user (no `extraInfo`).
export async function fetchDocuments(
  apiClient: AxiosInstance,
  { projectId, page, pageSize }: ListParams,
): Promise<Paged<AssetRow>> {
  const response = await apiClient.get<unknown>("/knowledge/documents", {
    params: { projectId, page, pageSize },
  });
  const parsed = documentsEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchDocuments");
}

// Experience tab — paginated playbooks. Each row carries the authoring DW's
// `extraInfo.agentInstance` (name + icon).
export async function fetchPlaybooks(
  apiClient: AxiosInstance,
  { projectId, page, pageSize }: ListParams,
): Promise<Paged<AssetRow>> {
  const response = await apiClient.get<unknown>("/knowledge/playbooks", {
    params: { projectId, page, pageSize },
  });
  const parsed = playbooksEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchPlaybooks");
}

// Deliverable tab — paginated published files. Each row carries the authoring
// DW's `extraInfo.agentInstance` (name + icon). Uses GET (POST 404s).
export async function fetchDeliverables(
  apiClient: AxiosInstance,
  { projectId, page, pageSize }: ListParams,
): Promise<Paged<AssetRow>> {
  const response = await apiClient.get<unknown>("/project/deliverables", {
    params: { projectId, page, pageSize },
  });
  const parsed = deliverablesEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchDeliverables");
}

// Single deliverable detail (`GET /project/deliverable?id=`) — feeds the
// full-page deliverable preview route. Returns the raw wire row (fileName +
// fileSasUrl + fileUri + agentInstance), mirroring `fetchKnowledgeDocument`.
export async function fetchDeliverableDetail(
  apiClient: AxiosInstance,
  id: number,
): Promise<DeliverableWire> {
  const response = await apiClient.get<unknown>("/project/deliverable", {
    params: { id },
  });
  const parsed = deliverableEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchDeliverableDetail").deliverable;
}

export async function fetchKnowledgeDocument(
  apiClient: AxiosInstance,
  id: number,
): Promise<KnowledgeDocument> {
  const response = await apiClient.get<unknown>("/knowledge/document", {
    params: { id },
  });
  const parsed = documentEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchKnowledgeDocument").document;
}

export async function fetchDocumentDetails(
  apiClient: AxiosInstance,
  id: number,
): Promise<DocumentDetails> {
  const response = await apiClient.get<unknown>("/knowledge/document/details", {
    params: { id },
  });
  const parsed = documentDetailsEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchDocumentDetails");
}

export async function fetchPlaybookDetails(
  apiClient: AxiosInstance,
  id: number,
): Promise<PlaybookDetails> {
  const response = await apiClient.get<unknown>("/knowledge/playbook/details", {
    params: { id },
  });
  const parsed = playbookDetailsEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchPlaybookDetails");
}

// The single playbook row (`GET /knowledge/playbook?id`) — unlike the `/details`
// body it carries `projectId`, so the top-level playbook detail page can resolve
// its owning project for back-navigation when there is no in-app history.
export async function fetchPlaybook(
  apiClient: AxiosInstance,
  id: number,
): Promise<PlaybookWire> {
  const response = await apiClient.get<unknown>("/knowledge/playbook", {
    params: { id },
  });
  const parsed = playbookEnvelope.parse(response.data);
  return unwrapData(parsed, "fetchPlaybook").playbook;
}
