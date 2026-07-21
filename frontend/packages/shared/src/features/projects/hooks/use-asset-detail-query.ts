import {
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import { useApiClient } from "../../../services/api-client-context";
import {
  type DeliverableWire,
  type DocumentDetails,
  ExtractionStatusSchema,
  type KnowledgeDocument,
  type PlaybookDetails,
  type PlaybookWire,
} from "../schemas/asset";
import {
  fetchDeliverableDetail,
  fetchDocumentDetails,
  fetchKnowledgeDocument,
  fetchPlaybook,
  fetchPlaybookDetails,
} from "../services/assets";

const { INGESTED } = ExtractionStatusSchema.enum;

// The caller knows which list the row came from, so the hook never probes both.
type AssetDetailParams = {
  id: number;
  type: "knowledge" | "experience" | "deliverable";
};

// Knowledge row + its extracted body, an Experience row + its body, OR a
// Deliverable file row. Discriminated on `type` so the view narrows fields. Both
// Knowledge and Experience fetch a ROW (carries `createdAt`/`projectId`) plus a
// `/details` BODY (the `/details` endpoints omit those fields).
export type AssetDetail =
  | ({ type: "knowledge" } & KnowledgeDocument & DocumentDetails)
  | ({ type: "experience" } & PlaybookWire & PlaybookDetails)
  | ({ type: "deliverable" } & DeliverableWire);

async function fetchAssetDetail(
  apiClient: AxiosInstance,
  { id, type }: AssetDetailParams,
): Promise<AssetDetail> {
  if (type === "knowledge") {
    const [row, body] = await Promise.all([
      fetchKnowledgeDocument(apiClient, id),
      fetchDocumentDetails(apiClient, id),
    ]);
    return { type: "knowledge", ...row, ...body };
  }
  if (type === "deliverable") {
    const row = await fetchDeliverableDetail(apiClient, id);
    return { type: "deliverable", ...row };
  }
  // Mirrors Knowledge: the playbook ROW carries `createdAt` (Detail panel) +
  // `projectId` (back-nav), which the `/details` BODY omits — fetch both.
  const [row, body] = await Promise.all([
    fetchPlaybook(apiClient, id),
    fetchPlaybookDetails(apiClient, id),
  ]);
  return { type: "experience", ...row, ...body };
}

export function assetDetailQueryOptions(
  params: AssetDetailParams,
  apiClient: AxiosInstance,
): {
  queryKey: readonly [
    "projects",
    "asset-detail",
    "knowledge" | "experience" | "deliverable",
    number,
  ];
  queryFn: () => Promise<AssetDetail>;
  staleTime: number;
} {
  return {
    queryKey: ["projects", "asset-detail", params.type, params.id] as const,
    queryFn: (): Promise<AssetDetail> => fetchAssetDetail(apiClient, params),
    staleTime: 30_000,
  };
}

// Readiness gate, PURE (§3/§4 P4) — the ROUTE runs it after resolve. `undefined`
// → not-found; a Knowledge row mid-extraction (status ≠ INGESTED) → redirect;
// an INGESTED Knowledge row or any Experience row → ok.
export function resolveAssetDetailGuard(
  asset: { status?: number } | undefined,
): "ok" | "not-found" | "redirect" {
  if (asset === undefined) {
    return "not-found";
  }
  if (asset.status === undefined) {
    return "ok";
  }
  return asset.status === INGESTED ? "ok" : "redirect";
}

// Read-only detail — no `refetchInterval` (the list owns extraction polling).
export function useAssetDetailQuery(
  params: AssetDetailParams,
): UseSuspenseQueryResult<AssetDetail> {
  const apiClient = useApiClient();
  return useSuspenseQuery(assetDetailQueryOptions(params, apiClient));
}
