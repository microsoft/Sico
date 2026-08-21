import { toast } from "@sico/ui";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";

import { useApiClient } from "../../../services/api-client-context";
import { logger } from "../../../utils/logger";
import { uploadAttachment } from "../../chat/services/upload";

export type CoverUpload = {
  inputRef: React.RefObject<HTMLInputElement | null>;
  uploading: boolean;
  /** Local objectURL preview shown while (and after) an upload resolves. */
  preview: string | undefined;
  onPick: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
};

type PickContext = {
  apiClient: ReturnType<typeof useApiClient>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  pickIdRef: React.RefObject<number>;
  abortRef: React.RefObject<AbortController | null>;
  setPreview: React.Dispatch<React.SetStateAction<string | undefined>>;
  setUploading: (value: boolean) => void;
  onChange: (iconUri: string | undefined) => void;
};

// Swap `preview` to a fresh objectURL, revoking whatever it replaces.
function swapPreview(
  setPreview: PickContext["setPreview"],
  next: string | undefined,
): void {
  setPreview((prev) => {
    if (prev) {
      URL.revokeObjectURL(prev);
    }
    return next;
  });
}

async function pickCover(
  ctx: PickContext,
  event: React.ChangeEvent<HTMLInputElement>,
): Promise<void> {
  const { apiClient, inputRef, pickIdRef, abortRef, setUploading, onChange } =
    ctx;
  const file = event.target.files?.[0];
  if (inputRef.current) {
    inputRef.current.value = "";
  }
  if (!file) {
    return;
  }
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  pickIdRef.current += 1;
  const pickId = pickIdRef.current;
  swapPreview(ctx.setPreview, URL.createObjectURL(file));
  setUploading(true);
  try {
    const uploaded = await uploadAttachment(apiClient, file, controller.signal);
    if (pickId !== pickIdRef.current) {
      return; // superseded by a newer pick — don't touch state
    }
    onChange(uploaded.uri);
  } catch (error) {
    // An abort — unmount cleanup or a superseded pick — is not a failure:
    // bail without touching state or toasting. `signal.aborted` covers the
    // unmount case (where pickId still matches), the id check the supersede
    // case. Without this, closing the dialog mid-upload flashes a false
    // "upload failed" toast and sets state on an unmounting component.
    if (controller.signal.aborted || pickId !== pickIdRef.current) {
      return;
    }
    logger.error("cover upload failed", { error });
    onChange(undefined);
    swapPreview(ctx.setPreview, undefined);
    toast.error("We couldn't upload the cover. Try again.");
  } finally {
    if (pickId === pickIdRef.current) {
      setUploading(false);
    }
  }
}

// Eager cover upload for the Create/Edit Project forms: click → local objectURL
// preview + Loader2 overlay while uploading → the resolved relative `uri` is
// stored on the form via `onChange`. A monotonic pick id keeps only the latest
// pick's result; an AbortController cancels a superseded/unmounted upload. Owns
// its own state so `CoverField` stays presentational.
export function useCoverUpload(
  onChange: (iconUri: string | undefined) => void,
): CoverUpload {
  const apiClient = useApiClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pickIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<string | undefined>();

  // Revoke the previous objectURL when it changes, and the last one on unmount.
  useEffect(
    () => () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    },
    [preview],
  );

  // Abort an in-flight upload ONLY on unmount. This must NOT depend on
  // `preview`: onPick sets the preview right before awaiting the upload, so a
  // `[preview]` cleanup would fire mid-upload and abort the request we just
  // started — the bytes reach the server (200) but axios discards the response
  // as canceled, surfacing as a spurious "upload failed".
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const onPick = (event: React.ChangeEvent<HTMLInputElement>): Promise<void> =>
    pickCover(
      {
        apiClient,
        inputRef,
        pickIdRef,
        abortRef,
        setPreview,
        setUploading,
        onChange,
      },
      event,
    );

  return { inputRef, uploading, preview, onPick };
}
