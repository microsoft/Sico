import {
  type AgentInstanceInfo,
  type DeliverableWire,
  type KnowledgeDocument,
  type KnowledgeItem,
  KnowledgeItemTypeSchema,
  type PlaybookWire,
} from "../schemas/asset";
import type { AssetRow } from "../types";

// ── Wire → client row mappers ───────────────────────────────────────────────
// The single wire→client boundary: each list endpoint's envelope `.transform`
// maps its wire rows to the canonical client `AssetRow` here, so callers (the
// query hook) receive `Paged<AssetRow>` and never touch wire shapes.

// Extract the authoring DW's display block the same way for every category —
// hoisted so the per-type mappers don't repeat the optional-chain.
// `agentInstanceId` is optional: a deliverable's wire id is nullish and no
// consumer navigates by it, so it stays absent rather than carrying a `0`
// sentinel.
function agentCreator(
  agentInstanceId: number | undefined,
  extra: AgentInstanceInfo,
): Extract<AssetRow["creator"], { kind: "agent" }> {
  return {
    kind: "agent",
    agentInstanceId,
    agentName: extra?.agentName,
    iconUrl: extra?.agentIconUrl,
  };
}

// A document's creator is the uploading USER; a playbook / deliverable's creator
// is the authoring DW (AGENT). The `all` list reuses these three by `type`.
export function documentToRow(doc: KnowledgeDocument): AssetRow {
  const { creatorUsername, ...rest } = doc;
  return {
    ...rest,
    type: "knowledge",
    creator: { kind: "user", username: creatorUsername },
  };
}

export function playbookToRow(playbook: PlaybookWire): AssetRow {
  // Drop `extraInfo` AND the raw `agentInstanceId` — both fold into `creator`;
  // leaving them would spread redundant wire fields onto the row (mirrors
  // documentToRow dropping its raw `creatorUsername`, so `creator` stays the
  // canonical source).
  const { extraInfo, agentInstanceId, ...rest } = playbook;
  return {
    ...rest,
    type: "experience",
    creator: agentCreator(agentInstanceId, extraInfo?.agentInstance),
  };
}

export function deliverableToRow(deliverable: DeliverableWire): AssetRow {
  return {
    type: "deliverable",
    id: deliverable.id,
    name: deliverable.fileName,
    createdAt: deliverable.createdAt,
    fileSasUrl: deliverable.fileSasUrl,
    creator: agentCreator(
      deliverable.agentInstanceId ?? undefined,
      deliverable.extraInfo?.agentInstance,
    ),
  };
}

// The mixed `all` list item → row (delegates to the per-type mappers by `type`).
export function knowledgeItemToRow(item: KnowledgeItem): AssetRow {
  if (item.type === KnowledgeItemTypeSchema.enum.DOCUMENT) {
    return documentToRow(item.document);
  }
  if (item.type === KnowledgeItemTypeSchema.enum.PLAYBOOK) {
    return playbookToRow(item.playbook);
  }
  return deliverableToRow(item.deliverable);
}
