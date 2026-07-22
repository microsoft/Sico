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
