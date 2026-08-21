import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, unwrapData } from "../../../schemas/api";

const assetEnvelope = apiResponseSchema(
  z.object({ id: z.number().int().safe() }),
);

// Uploads one file and returns its assetId. The skill create/replace flow
// uploads each file to the asset store first, then references the returned
// assetId in createSkill/updateSkill (mirrors legacy uploadProjectAsset).
export async function uploadSkillAsset(
  apiClient: AxiosInstance,
  file: File,
): Promise<number> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<unknown>("/project/asset", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return unwrapData(assetEnvelope.parse(res.data), "uploadSkillAsset").id;
}
