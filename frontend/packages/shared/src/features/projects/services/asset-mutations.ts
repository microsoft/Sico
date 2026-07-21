import type { AxiosInstance } from "axios";
import { z } from "zod";

import { apiResponseSchema, assertOk, unwrapData } from "../../../schemas/api";
import {
  type DocumentType,
  type UploadArtifact,
  uploadArtifactSchema,
} from "../schemas/asset";

const idEnvelope = apiResponseSchema(z.object({ id: z.number().int() }));
const uploadEnvelope = apiResponseSchema(uploadArtifactSchema);

type RegisterDocumentBody = {
  projectId: number;
  assetId?: number;
  linkUrl?: string;
  documentType: DocumentType;
  tagIds: number[];
  name?: string;
  iconUri?: string;
};

export async function registerDocument(
  apiClient: AxiosInstance,
  body: RegisterDocumentBody,
): Promise<number> {
  const response = await apiClient.post<unknown>("/knowledge/document", body);
  const parsed = idEnvelope.parse(response.data);
  return unwrapData(parsed, "registerDocument").id;
}

type EditDocumentBody = {
  id: number;
  name?: string;
  tagIds: number[];
};

export async function editDocument(
  apiClient: AxiosInstance,
  body: EditDocumentBody,
): Promise<number> {
  const response = await apiClient.put<unknown>("/knowledge/document", body);
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "editDocument");
  return body.id;
}

export async function deleteDocument(
  apiClient: AxiosInstance,
  id: number,
): Promise<void> {
  const response = await apiClient.delete<unknown>("/knowledge/document", {
    params: { id },
  });
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "deleteDocument");
}

// Delete an Experience playbook. The backend playbook group mirrors document
// (GET/PUT here; DELETE added for the remove action) — same `?id` query +
// envelope shape as `deleteDocument`.
export async function deletePlaybook(
  apiClient: AxiosInstance,
  id: number,
): Promise<void> {
  const response = await apiClient.delete<unknown>("/knowledge/playbook", {
    params: { id },
  });
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "deletePlaybook");
}

// Delete a Deliverable (a file a Digital Worker published). Same `?id` query +
// envelope shape as the other deletes.
export async function deleteDeliverable(
  apiClient: AxiosInstance,
  id: number,
): Promise<void> {
  const response = await apiClient.delete<unknown>("/project/deliverable", {
    params: { id },
  });
  const parsed = apiResponseSchema(z.unknown()).parse(response.data);
  assertOk(parsed, "deleteDeliverable");
}

export async function uploadAsset(
  apiClient: AxiosInstance,
  projectId: number,
  file: File,
  signal?: AbortSignal,
): Promise<UploadArtifact> {
  const form = new FormData();
  form.append("project_id", String(projectId));
  form.append("file", file);
  const response = await apiClient.post<unknown>("/project/asset", form, {
    signal,
  });
  const parsed = uploadEnvelope.parse(response.data);
  return unwrapData(parsed, "uploadAsset");
}
