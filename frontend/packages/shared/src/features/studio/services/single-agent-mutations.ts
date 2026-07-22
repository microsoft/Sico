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

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";

// Legacy: POST/PUT dwp/agent/single_agent + POST dwp/agent/single_agent/deploy.
// The dwp prefix is dropped in this repo (apiClient baseURL `/api/sico`), so the
// paths are /agent/single_agent and /agent/single_agent/deploy. Mirrors the
// pre-migration `SingleAgentService` create/update/deploy contracts verbatim
// (request bodies and response shapes unchanged).

const createResultSchema = z.object({ agentId: z.string() });
export type CreateSingleAgentResult = z.infer<typeof createResultSchema>;
const createEnvelope = apiResponseSchema(createResultSchema);

const deployResultSchema = z.object({
  id: z.number().int().safe(),
  agentId: z.string(),
  employerUsername: z.string().default(""),
});
export type DeploySingleAgentResult = z.infer<typeof deployResultSchema>;
const deployEnvelope = apiResponseSchema(deployResultSchema);

// update carries no `data` — branch on `code` only (assertOk).
const writeEnvelope = apiResponseSchema(z.unknown());

export type CreateSingleAgentInput = {
  name: string;
  role: string;
  desc?: string;
};

export async function createSingleAgent(
  apiClient: AxiosInstance,
  { name, role, desc = "" }: CreateSingleAgentInput,
): Promise<CreateSingleAgentResult> {
  const res = await apiClient.post<unknown>("/agent/single_agent", {
    name,
    role,
    desc,
  });
  return unwrapData(createEnvelope.parse(res.data), "createSingleAgent");
}

export type UpdateSingleAgentInput = {
  agentId: string;
  name: string;
  role: string;
  desc?: string;
};

export async function updateSingleAgent(
  apiClient: AxiosInstance,
  { agentId, name, role, desc = "" }: UpdateSingleAgentInput,
): Promise<void> {
  const res = await apiClient.put<unknown>("/agent/single_agent", {
    agentId,
    name,
    role,
    desc,
  });
  assertOk(writeEnvelope.parse(res.data), "updateSingleAgent");
}

export type DeploySingleAgentInput = {
  agentId: string;
  name: string;
};

export async function deploySingleAgent(
  apiClient: AxiosInstance,
  { agentId, name }: DeploySingleAgentInput,
): Promise<DeploySingleAgentResult> {
  const res = await apiClient.post<unknown>("/agent/single_agent/deploy", {
    agentId,
    name,
  });
  return unwrapData(deployEnvelope.parse(res.data), "deploySingleAgent");
}
