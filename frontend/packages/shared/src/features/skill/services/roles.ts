import type { AxiosInstance } from "axios";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";
import { type Role, rolesPayloadSchema } from "../schemas/roles";

const rolesEnvelope = apiResponseSchema(rolesPayloadSchema);

export async function fetchRoles(apiClient: AxiosInstance): Promise<Role[]> {
  const res = await apiClient.get<unknown>("/agent/roles");
  return unwrapData(rolesEnvelope.parse(res.data), "fetchRoles");
}
