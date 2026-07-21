import { z } from "zod";

import { apiResponseSchema } from "../../../schemas/api";

// Inner payload of the asset-upload response (legacy `UploadAssetResponse`).
export const uploadAssetResponseSchema = z.object({
  id: z.number(),
  metaInfo: z.object({
    contentType: z.string(),
    fileExt: z.string(),
    fileName: z.string(),
    fileSize: z.number(),
    fileType: z.string(),
  }),
  sasUrl: z.string(),
  uri: z.string(),
});

// Carried inside the standard axios {code,msg,data} envelope.
export const uploadEnvelopeSchema = apiResponseSchema(
  uploadAssetResponseSchema,
);

// Direct-to-blob upload (avoids the ingress body-size limit that a plain
// multipart POST hits for large files, e.g. apks). Three steps:
//   1. POST /project/asset/upload_url  → a short-lived storage URL + objectKey
//   2. PUT the bytes straight to blob storage (bypasses our backend ingress)
//   3. POST /project/asset/complete    → registers the asset, returns sasUrl
// Step 1 request: the file's metadata the backend needs to mint the URL.
export const createAssetUploadUrlRequestSchema = z.object({
  fileName: z.string(),
  fileSize: z.number(),
  contentType: z.string(),
});
export type CreateAssetUploadUrlRequest = z.infer<
  typeof createAssetUploadUrlRequestSchema
>;

// Step 1 response payload: where + how to PUT the bytes. `method`/`headers`
// degrade to sane defaults (PUT, none) so a partial backend response still
// drives a usable upload; `objectKey` is echoed back to `complete`.
export const createAssetUploadUrlDataSchema = z.object({
  uploadUrl: z.string(),
  objectKey: z.string(),
  method: z.string().catch("PUT"),
  headers: z.record(z.string(), z.string()).catch({}),
});
export const createAssetUploadUrlEnvelopeSchema = apiResponseSchema(
  createAssetUploadUrlDataSchema,
);

// Step 3 request: `objectKey` from step 1 plus the same file metadata, so the
// backend can register the now-uploaded blob as an asset. Response reuses
// `uploadEnvelopeSchema` (same {id, metaInfo, sasUrl, uri} shape).
export const completeAssetUploadRequestSchema = z.object({
  objectKey: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  contentType: z.string(),
});
export type CompleteAssetUploadRequest = z.infer<
  typeof completeAssetUploadRequestSchema
>;
