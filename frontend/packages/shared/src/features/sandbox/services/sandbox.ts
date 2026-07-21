import type { AxiosInstance } from "axios";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import { type Sandbox, sandboxInstanceDataSchema } from "../schemas/sandbox";

// `GET /sandbox/instance?instanceId=` → the agent's live sandbox devices. The
// backend wraps the payload in the standard `{ code, msg, data:{items} }`
// envelope; `unwrapData` rejects a non-OK code before reading `data`.
const responseSchema = apiResponseSchema(sandboxInstanceDataSchema);

export async function fetchSandboxInstances(
  apiClient: AxiosInstance,
  agentInstanceId: number,
): Promise<Sandbox[]> {
  const response = await apiClient.get<unknown>("/sandbox/instance", {
    params: { instanceId: String(agentInstanceId) },
  });
  const parsed = responseSchema.parse(response.data);
  return unwrapData(parsed, "fetchSandboxInstances").items;
}
