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

import { toast } from "@sico/ui";
import { useAtom } from "jotai";
import { type Dispatch, type SetStateAction, useState } from "react";

import { makeId } from "../../../utils/id";
import { logger } from "../../../utils/logger";
import { type Attachment, attachmentsAtom } from "../atoms/chat-atom";
import { MAX_ATTACHMENT_BYTES } from "../constants";
import { type ChatAttachmentRef } from "../schemas/chat-request";

// Hardcoded copy — the chat feature has no i18n. FILE_TOO_LARGE must read
// "16 MB" (the composer test matches /over 16 MB/i); uploadFailed mirrors
// design.md's collab.upload.failed copy.
const FILE_TOO_LARGE = "That file is over 16 MB. Pick a smaller one.";
const uploadFailed = (name: string): string =>
  `Couldn't upload "${name}". Try adding it again.`;

type UploadFn = (file: File, signal: AbortSignal) => Promise<ChatAttachmentRef>;
type SetAttachments = Dispatch<SetStateAction<Attachment[]>>;

type PendingUpload = {
  upload: UploadFn;
  setAttachments: SetAttachments;
  file: File;
  localId: string;
  signal: AbortSignal;
};

// Stateless upload reconciler, extracted from the hook. On success, flip the
// chip to `ready`; on reject, drop the chip and (unless the signal aborted —
// i.e. the user removed it) toast the failure. Abort vs failure is
// distinguished by the signal, never conflated (§3).
async function uploadThenReconcile(p: PendingUpload): Promise<void> {
  const { upload, setAttachments, file, localId, signal } = p;
  try {
    const assetRef = await upload(file, signal);
    setAttachments((prev) =>
      prev.map(
        (a): Attachment =>
          a.localId === localId ? { ...a, status: "ready", assetRef } : a,
      ),
    );
  } catch (err) {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
    if (!signal.aborted) {
      // A genuine failure (not a user-removed abort) — surface to the user AND
      // leave a diagnostic trail, mirroring the SSE path in chat.ts. An aborted
      // upload stays silent: it is an expected user action, not an error.
      logger.error("chat: attachment upload failed", { err });
      toast.error(uploadFailed(file.name));
    }
  }
}

export type ComposerAttachments = {
  attachments: Attachment[];
  anyUploading: boolean;
  fileError: string | null;
  addFile: (file: File) => void;
  removeAttachment: (localId: string) => void;
  clear: () => void;
};

// Owns the composer's attachment lifecycle: the 16 MiB validation, eager upload
// (each chip carries its own AbortController so remove can cancel an in-flight
// upload), and the inline over-cap error.
export function useComposerAttachments(upload: UploadFn): ComposerAttachments {
  const [attachments, setAttachments] = useAtom(attachmentsAtom);
  const [fileError, setFileError] = useState<string | null>(null);

  const addFile = (file: File): void => {
    setFileError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setFileError(FILE_TOO_LARGE);
      return;
    }
    const controller = new AbortController();
    const localId = makeId();
    setAttachments((prev) => [
      ...prev,
      { localId, file, status: "uploading", abortHandle: controller },
    ]);
    void uploadThenReconcile({
      upload,
      setAttachments,
      file,
      localId,
      signal: controller.signal,
    });
  };

  const removeAttachment = (localId: string): void => {
    attachments.find((a) => a.localId === localId)?.abortHandle?.abort();
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  };

  const clear = (): void => {
    setAttachments([]);
    // Reset the over-cap alert too, so a fresh message starts clean after send.
    setFileError(null);
  };

  return {
    attachments,
    anyUploading: attachments.some((a) => a.status === "uploading"),
    fileError,
    addFile,
    removeAttachment,
    clear,
  };
}
