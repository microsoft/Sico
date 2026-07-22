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

import { z } from "zod";

// ════════════════════════════════════════════════════════════════════════════
// WIRE SCHEMAS — the shapes the backend sends, parsed at the network boundary.
// Everything here is a Zod schema (untrusted input must be validated once). The
// CLIENT models the UI works with are derived from these as plain TS types in
// `../types` (no second parse — "parse, don't validate").
// ════════════════════════════════════════════════════════════════════════════

// Wire value is the integer — int32 proto enum, no MarshalJSON (§8 C, OQ-D).
export const ExtractionStatusSchema = z.enum({
  UNKNOWN: 0,
  FAILED: 1,
  UPLOADED: 2,
  INGESTED: 3,
});
export type ExtractionStatus = z.infer<typeof ExtractionStatusSchema>;

export const DocumentTypeSchema = z.enum({ FILE: 1, LINK: 2 });
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

// One KnowledgeTag ref as it rides on a document or playbook row (read shape).
const tagRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});

// Tag arrays must tolerate BOTH absence and explicit null: the Go backend
// marshals an empty slice as JSON `null`, and `.default([])` fills only
// `undefined` (it throws on null). Coerce either to `[]` so list parsing never
// fails (§8 C — "the Experience list never fails").
const tagArray = z
  .array(tagRefSchema)
  .nullish()
  .transform((v) => v ?? []);

// A Knowledge document wire row (`GET /knowledge/documents`, `…/document?id`).
// Parsed defensively: `assetId`/`sourceFile`/`linkUrl`/`failReason` differ
// between the list and detail endpoints, so they are `.nullish()`. The
// display-name fallback (name → attachment.name → linkUrl) is a component
// concern (§8 C).
export const knowledgeDocumentWireSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  documentType: DocumentTypeSchema,
  status: ExtractionStatusSchema,
  failReason: z.string().nullish(),
  tags: tagArray,
  assetId: z.number().int().nullish(),
  sourceFile: z.string().nullish(),
  linkUrl: z.string().nullish(),
  // The uploaded file's real name carries the extension the display `name` often
  // lacks, so the file-type icon derives from `attachment.name`. `sasUrl` is the
  // same-origin `/storage/*` URL the Source file chip links to; `null` for LINK.
  attachment: z
    .object({
      name: z.string(),
      uri: z.string().nullish(),
      sasUrl: z.string().nullish(),
      type: z.string().nullish(),
      size: z.number().nullish(),
      id: z.number().int().nullish(),
    })
    .nullish(),
  creatorUsername: z.string(),
  // Backend sends epoch ms — `formatDateTime` (the only consumer) assumes ms.
  createdAt: z.number().int(),
});
// Named `KnowledgeDocument` (no `Wire` suffix, unlike `PlaybookWire` /
// `DeliverableWire`) on purpose: this is the knowledge DOMAIN entity, reused for
// both the list row AND the single-document detail object
// (`use-asset-detail-query` composes `{type:"knowledge"} & KnowledgeDocument &
// DocumentDetails`). The sibling playbook/deliverable wire types are list-only,
// so the `Wire` suffix fits them but would mis-describe this one.
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentWireSchema>;

// Knowledge body (`GET /knowledge/document/details?id`) — split from the row.
export const documentDetailsSchema = z.object({
  summary: z.string(),
  fullText: z.string(),
});
export type DocumentDetails = z.infer<typeof documentDetailsSchema>;

// `extraInfo.agentInstance` — the authoring Digital Worker's display name +
// icon, plus the human `operatorUsername` who ran it. Carried on the wire for
// playbook + deliverable rows. Tolerant (nullish) so a missing block degrades to
// the icon-only / id fallback rather than failing the list parse. Shared by the
// playbook + deliverable wire rows.
export const agentInstanceInfoSchema = z
  .object({
    agentName: z.string(),
    agentIconUrl: z.string(),
    // The human operator's username — surfaced as the Experience Detail panel's
    // "Operator" (Experience nests it here, unlike Deliverable's top-level
    // `creatorUsername`).
    operatorUsername: z.string(),
  })
  .partial()
  .nullish();
export type AgentInstanceInfo = z.infer<typeof agentInstanceInfoSchema>;

// An Experience playbook wire row. `extraInfo.agentInstance` (the authoring DW's
// name + icon) is OPTIONAL: the LIST endpoints (`/knowledge/playbooks`, unified
// `/knowledge/items` type:2) carry it; the SINGLE-row detail endpoint
// (`/knowledge/playbook?id`) omits it. Because it is `.nullish()`, this one
// schema covers both — a missing block just parses to `undefined`. `tags` are
// parsed but not consumed yet (no Experience tag UI, §9 D).
export const playbookWireSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  projectId: z.number().int(),
  agentInstanceId: z.number().int(),
  tags: tagArray,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  extraInfo: z.object({ agentInstance: agentInstanceInfoSchema }).nullish(),
});
export type PlaybookWire = z.infer<typeof playbookWireSchema>;

// Experience body (`GET /knowledge/playbook/details?id`) — mirrors document
// details; the list row never carries `content`.
export const playbookDetailsSchema = z.object({
  content: z.string(),
  name: z.string(),
});
export type PlaybookDetails = z.infer<typeof playbookDetailsSchema>;

// A Deliverable wire row (`/project/deliverables`, unified `/knowledge/items`
// type:3). The authoring DW's name + icon ride in `extraInfo.agentInstance`.
// Mapped to the client `DeliverableRow` by `deliverableToRow` in
// `services/assets.ts` (`fileName` → `name`).
export const deliverableWireSchema = z.object({
  id: z.number().int(),
  projectId: z.number().int().nullish(),
  fileName: z.string(),
  fileUri: z.string().nullish(),
  fileSasUrl: z.string().nullish(),
  creatorUsername: z.string().nullish(),
  agentInstanceId: z.number().int().nullish(),
  createdAt: z.number().int(),
  updatedAt: z.number().int().nullish(),
  extraInfo: z.object({ agentInstance: agentInstanceInfoSchema }).nullish(),
});
export type DeliverableWire = z.infer<typeof deliverableWireSchema>;

// Upload artifact returned by `POST /project/asset` (§7 C) — the blob a later
// `POST /knowledge/document` references by `assetId`. Named `uploadArtifact` to
// avoid colliding with the asset row. Mirrors chat's `uploadAssetResponseSchema`;
// promote to a shared schema once it gains a second consumer.
export const uploadArtifactSchema = z.object({
  id: z.number().int(),
  sasUrl: z.string(),
  uri: z.string(),
  metaInfo: z.object({
    contentType: z.string(),
    fileExt: z.string(),
    fileName: z.string(),
    fileSize: z.number(),
    fileType: z.string(),
  }),
});
export type UploadArtifact = z.infer<typeof uploadArtifactSchema>;

// ──────────────────────────────────────────────────────────────────────────
// The unified knowledge list (`GET /knowledge/items`) — the backend returns ONE
// list of mixed items discriminated by an integer `type`, replacing the separate
// `/knowledge/documents` + `/knowledge/playbooks` loads and adding deliverables.
// Each item wraps one of the wire rows above.
// ──────────────────────────────────────────────────────────────────────────

// Wire enum — int values, modeled as `z.enum` (TS `enum` banned); access via
// `KnowledgeItemTypeSchema.enum.DOCUMENT`.
export const KnowledgeItemTypeSchema = z.enum({
  DOCUMENT: 1,
  PLAYBOOK: 2,
  DELIVERABLE: 3,
});
export type KnowledgeItemType = z.infer<typeof KnowledgeItemTypeSchema>;

// type:1 → a knowledge document. The wire object is a structural SUPERSET of
// `knowledgeDocumentWireSchema` (extra `projectId`/`updatedAt`/`iconUri`/
// `iconSasUrl` are ignored), so reuse the existing schema — do NOT fork it (the
// detail path shares it).
const documentItemSchema = z.object({
  type: z.literal(KnowledgeItemTypeSchema.enum.DOCUMENT),
  document: knowledgeDocumentWireSchema,
  updatedAt: z.number().int().nullish(),
});

// type:2 → an experience playbook. Reuse the shared playbook wire row.
const playbookItemSchema = z.object({
  type: z.literal(KnowledgeItemTypeSchema.enum.PLAYBOOK),
  playbook: playbookWireSchema,
  updatedAt: z.number().int().nullish(),
});

// type:3 → a deliverable (a file a Digital Worker published). New this release.
const deliverableItemSchema = z.object({
  type: z.literal(KnowledgeItemTypeSchema.enum.DELIVERABLE),
  deliverable: deliverableWireSchema,
  updatedAt: z.number().int().nullish(),
});

// A single list item — discriminated on the wire `type` int. `.catch`-less
// here: an unknown type should surface (the list is small, all-or-nothing per
// the unified endpoint's design), unlike the display-only enums elsewhere.
export const knowledgeItemSchema = z.discriminatedUnion("type", [
  documentItemSchema,
  playbookItemSchema,
  deliverableItemSchema,
]);
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

// Envelope `data.{ items, total, hasNext }`.
export const knowledgeItemsDataSchema = z.object({
  items: z.array(knowledgeItemSchema),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean().nullish(),
});
