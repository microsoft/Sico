import type { AxiosInstance } from "axios";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import {
  type SingleAgentDetail,
  singleAgentPayloadSchema,
} from "../schemas/single-agent";
import {
  agentInfosPayloadSchema,
  type SingleAgentCard,
} from "../schemas/single-agent-card";

const agentInfosEnvelope = apiResponseSchema(agentInfosPayloadSchema);
const singleAgentEnvelope = apiResponseSchema(singleAgentPayloadSchema);

// Legacy: GET dwp/agent/single_agent_infos. The dwp prefix is dropped in the
// new repo (apiClient baseURL `/api/sico`), so the path is /agent/single_agent_infos.
export async function fetchAgentInfos(
  apiClient: AxiosInstance,
): Promise<SingleAgentCard[]> {
  const res = await apiClient.get<unknown>("/agent/single_agent_infos");
  return unwrapData(agentInfosEnvelope.parse(res.data), "fetchAgentInfos");
}

// Legacy: GET dwp/agent/single_agent?agentId=<uuid>. The dwp prefix is dropped
// (baseURL `/api/sico`), so the path is /agent/single_agent. Returns the
// UUID-keyed studio draft (name/role) that backs the setup page — distinct from
// the numeric single_agent_instance detail.
export async function fetchSingleAgent(
  apiClient: AxiosInstance,
  agentId: string,
): Promise<SingleAgentDetail> {
  const res = await apiClient.get<unknown>("/agent/single_agent", {
    params: { agentId },
  });
  return unwrapData(singleAgentEnvelope.parse(res.data), "fetchSingleAgent");
}
