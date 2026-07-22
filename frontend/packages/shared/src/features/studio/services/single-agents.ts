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
