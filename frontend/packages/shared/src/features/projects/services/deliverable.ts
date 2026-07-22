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

import { apiResponseSchema, assertOk } from "../../../schemas/api";

// "Add to project" body (backend POST /project/deliverable): publish a Digital
// Worker's deliverable file into a project's assets. `fileUri` is the blob-
// relative path (parsed from the deliverable's SAS url), NOT the full url.
export type AddDeliverableInput = {
  projectId: number;
  agentInstanceId: number;
  fileUri: string;
  fileName: string;
};

// The backend returns the standard `{ code, msg, data }` envelope; we only need
// to confirm a non-error code (no data payload is read), so parse the envelope
// shape and surface a non-OK code via `assertOk`.
const responseSchema = apiResponseSchema(z.unknown());

export async function addDeliverableToProject(
  apiClient: AxiosInstance,
  input: AddDeliverableInput,
): Promise<void> {
  const response = await apiClient.post<unknown>("/project/deliverable", input);
  const parsed = responseSchema.parse(response.data);
  assertOk(parsed, "addDeliverableToProject");
}
