// Shared domain types for the projects feature that are NOT Zod schemas —
// values the UI works with that never cross the network boundary, so they need
// no runtime validation (unlike the wire models in `schemas/`). The client row
// types here are derived from the wire schemas in `schemas/asset.ts` so the two
// never drift ("parse, don't validate" — wire is parsed once, client is types).

import type { KnowledgeDocument, PlaybookWire } from "./schemas/asset";

// The assets list is partitioned into four categories, carried as a URL PATH
// segment (`/project/$id` = all, `/project/$id/knowledge` etc.), not a `?tab=`
// query param. `all` is the mixed view (not a real asset type); the other three
// each back a dedicated paginated endpoint. A plain TS union, not a Zod schema:
// the value comes from the route path (one literal per route file), so it never
// reaches a `parse`.
export type AssetCategory = "all" | "knowledge" | "deliverable" | "experience";

// The CREATOR is a discriminated union, never a bare string (§8 C): a Knowledge
// doc is uploaded by a user; an Experience playbook / Deliverable is authored by
// a DW. The DW's name + icon come from the wire's `extraInfo.agentInstance`.
// `agentInstanceId` is optional — a deliverable's wire id is nullish and no
// consumer navigates by it, so it stays absent rather than carrying a `0`
// sentinel.
export type AssetCreator =
  | { kind: "user"; username: string }
  | {
      kind: "agent";
      agentInstanceId?: number;
      iconUrl?: string;
      agentName?: string;
    };

// A Knowledge row — the wire document with its raw `creatorUsername` folded into
// the canonical `creator` union (omitted so no consumer bypasses it, §8 C).
export type KnowledgeRow = Omit<KnowledgeDocument, "creatorUsername"> & {
  type: "knowledge";
  creator: AssetCreator;
};

// An Experience row — the wire playbook with its `extraInfo` and raw
// `agentInstanceId` folded into the canonical `creator` (both dropped so the row
// carries no redundant wire field, mirroring KnowledgeRow dropping
// `creatorUsername`).
export type ExperienceRow = Omit<
  PlaybookWire,
  "extraInfo" | "agentInstanceId"
> & {
  type: "experience";
  creator: AssetCreator;
};

// A Deliverable row — a file a Digital Worker published (new this release). NOT
// derived from `DeliverableWire` via `Omit` because the wire `fileName` is
// renamed to `name` here (the common table column), so the shape is declared
// explicitly. `creator` folds the wire's `extraInfo`/`agentInstanceId`; the row
// click opens `fileSasUrl` (scheme-gated via `safeIconUri`).
export type DeliverableRow = {
  type: "deliverable";
  id: number;
  name: string;
  createdAt: number;
  fileSasUrl?: string | null;
  creator: AssetCreator;
};

// Unified table row — the client-side merge of the three row kinds. The common
// columns (id · name · createdAt) sit at the top level for the uniform table.
export type AssetRow = KnowledgeRow | ExperienceRow | DeliverableRow;
