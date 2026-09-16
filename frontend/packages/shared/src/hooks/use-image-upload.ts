import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { toast } from "@sico/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";

import { useApiClient } from "../services/api-client-context";
import { uploadAttachment } from "../services/upload-attachment";
import { logger } from "../utils/logger";

export type ImageUpload = {
  inputRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  preview: string | undefined;
  onPick: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  uploadFile: (file: File) => Promise<string | undefined>;
  reset: () => void;
};

type UploadState = Pick<ImageUpload, "uploading" | "preview">;
type ActiveUpload = { controller: AbortController; preview: string };
type PickContext = {
  apiClient: ReturnType<typeof useApiClient>;
  activeRef: React.RefObject<ActiveUpload | null>;
  setState: React.Dispatch<React.SetStateAction<UploadState>>;
  onChange: (uri: string | undefined) => void;
};

const EMPTY_UPLOAD: UploadState = { uploading: false, preview: undefined };
const UPLOAD_FAILED = msg({
  id: "common.imageUpload.failed",
  message: "We couldn't upload the image. Try again.",
});

function clearUpload(activeRef: PickContext["activeRef"]): void {
  const active = activeRef.current;
  activeRef.current = null;
  if (active) {
    active.controller.abort();
    URL.revokeObjectURL(active.preview);
  }
}

async function uploadImage(
  ctx: PickContext,
  file: File,
): Promise<string | undefined> {
  const { activeRef, apiClient, setState, onChange } = ctx;
  clearUpload(activeRef);
  const active = {
    controller: new AbortController(),
    preview: URL.createObjectURL(file),
  };
  activeRef.current = active;
  setState({ uploading: true, preview: active.preview });
  try {
    const uploaded = await uploadAttachment(
      apiClient,
      file,
      active.controller.signal,
    );
    // Identity also invalidates clients that resolve despite cancellation.
    if (activeRef.current === active && !active.controller.signal.aborted) {
      onChange(uploaded.uri);
      return uploaded.uri;
    }
  } catch (error) {
    if (activeRef.current !== active || active.controller.signal.aborted) {
      return undefined;
    }
    clearUpload(activeRef);
    onChange(undefined);
    setState(EMPTY_UPLOAD);
    logger.error("image upload failed", { error });
    toast.error(i18n._(UPLOAD_FAILED));
  } finally {
    if (activeRef.current === active) {
      setState((previous) => ({ ...previous, uploading: false }));
    }
  }
  return undefined;
}

/** Single-image upload shared by project covers and DW avatars. */
export function useImageUpload(
  onChange: (uri: string | undefined) => void,
): ImageUpload {
  const apiClient = useApiClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<ActiveUpload | null>(null);
  const [state, setState] = useState<UploadState>(EMPTY_UPLOAD);
  const reset = useCallback((): void => {
    clearUpload(activeRef);
    setState(EMPTY_UPLOAD);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  // Preview changes must not cancel the request that just created that preview.
  useEffect(() => () => clearUpload(activeRef), []);
  const uploadFile = (file: File): Promise<string | undefined> =>
    uploadImage({ apiClient, activeRef, setState, onChange }, file);
  const onPick = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (file) {
      await uploadFile(file);
    }
  };

  return { inputRef, ...state, onPick, uploadFile, reset };
}
