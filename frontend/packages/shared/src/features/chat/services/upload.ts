import { type AxiosInstance } from "axios";
import { z } from "zod";

import { HTTP_OK } from "../../../constants/http";
import { unwrapData } from "../../../schemas/api";
import { type ChatAttachmentRef } from "../schemas/chat-request";
import {
  completeAssetUploadRequestSchema,
  createAssetUploadUrlEnvelopeSchema,
  createAssetUploadUrlRequestSchema,
  uploadEnvelopeSchema,
} from "../schemas/upload";

const UPLOAD_PATH = "/project/asset";
const UPLOAD_URL_PATH = "/project/asset/upload_url";
const UPLOAD_COMPLETE_PATH = "/project/asset/complete";

// Eager single-file upload (domain, plain fn). Holds no state — the caller
// owns the AbortController and passes `signal`. Returns the ready asset ref or
// throws (envelope failure / non-OK code / missing data → upload-fail path).
export async function uploadAttachment(
  apiClient: AxiosInstance,
  file: File,
  signal: AbortSignal,
): Promise<ChatAttachmentRef> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.post<unknown>(UPLOAD_PATH, form, { signal });
  const parsed = uploadEnvelopeSchema.parse(res.data);
  if (parsed.code !== HTTP_OK || !parsed.data) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["data"],
        message: `uploadAttachment: upload rejected (code ${parsed.code})`,
      },
    ]);
  }
  const asset = parsed.data;
  return {
    name: asset.metaInfo.fileName,
    size: asset.metaInfo.fileSize,
    type: asset.metaInfo.fileType,
    uri: asset.uri,
    sasUrl: asset.sasUrl,
  };
}

// Reject a step-1 upload URL that isn't http(s) before it reaches `fetch`. The
// backend mints this URL, but it's `z.string()` on the wire, so a poisoned
// response could smuggle a `file:`/`data:` scheme; the SAS token rides the query
// string, so `?` must be allowed (unlike a same-origin path guard).
function assertHttpUrl(url: string): string {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error("uploadProjectAssetDirect: malformed upload URL");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("uploadProjectAssetDirect: unsupported upload URL scheme");
  }
  return url;
}

// Step 2 of the direct upload: PUT the bytes straight to blob storage. A bare
// `fetch` (not `apiClient`) on purpose — the shared client would attach our
// Authorization header (Azure Blob 401s on it) and try to parse the empty PUT
// response as a {code,msg,data} envelope. `x-ms-blob-content-type` sets the
// stored blob's type; `...headers` carries any backend-required signed headers.
async function putBytesToBlob(
  target: {
    uploadUrl: string;
    method: string;
    headers: Record<string, string>;
  },
  file: File,
  contentType: string,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(assertHttpUrl(target.uploadUrl), {
    method: target.method || "PUT",
    body: file,
    headers: {
      "Content-Type": contentType,
      "x-ms-blob-content-type": contentType,
      ...target.headers,
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `uploadProjectAssetDirect: blob PUT failed (${res.status})`,
    );
  }
}

// Direct-to-blob upload for large files (apks) that a plain multipart POST to
// `/project/asset` can't carry — the bytes would exceed the backend ingress
// body limit (→ 412). Mirrors legacy `uploadProjectAssetDirect`: mint a storage
// URL, PUT the bytes straight to blob storage (past the ingress), then register
// the asset. Returns the same ready `ChatAttachmentRef` as `uploadAttachment`
// (the caller only needs `sasUrl`). `signal` cancels the long PUT.
export async function uploadProjectAssetDirect(
  apiClient: AxiosInstance,
  file: File,
  signal?: AbortSignal,
): Promise<ChatAttachmentRef> {
  const contentType = file.type || "application/octet-stream";
  const meta = createAssetUploadUrlRequestSchema.parse({
    fileName: file.name,
    fileSize: file.size,
    contentType,
  });

  // Step 1: mint the short-lived storage URL.
  const createRes = await apiClient.post<unknown>(UPLOAD_URL_PATH, meta, {
    signal,
  });
  const createParsed = createAssetUploadUrlEnvelopeSchema.parse(createRes.data);
  const { uploadUrl, objectKey, method, headers } = unwrapData(
    createParsed,
    "createAssetUploadUrl",
  );

  // Step 2: PUT the bytes directly to blob storage.
  await putBytesToBlob(
    { uploadUrl, method, headers },
    file,
    contentType,
    signal,
  );

  // Step 3: register the uploaded blob as an asset → get its `sasUrl`.
  const completeBody = completeAssetUploadRequestSchema.parse({
    objectKey,
    fileName: file.name,
    fileSize: file.size,
    contentType,
  });
  const completeRes = await apiClient.post<unknown>(
    UPLOAD_COMPLETE_PATH,
    completeBody,
    { signal },
  );
  const completeParsed = uploadEnvelopeSchema.parse(completeRes.data);
  const asset = unwrapData(completeParsed, "completeAssetUpload");
  return {
    name: asset.metaInfo.fileName,
    size: asset.metaInfo.fileSize,
    type: asset.metaInfo.fileType,
    uri: asset.uri,
    sasUrl: asset.sasUrl,
  };
}
