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
