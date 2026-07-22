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

import { InputGroup, InputGroupAddon } from "@sico/ui";
import { useAtomValue } from "jotai";
import { type ClipboardEvent, type JSX, useState } from "react";

import { AttachmentBar } from "./attachment-bar";
import { ComposerAttachButton } from "./composer-attach-button";
import { ComposerInput } from "./composer-input";
import { ComposerSendButton } from "./composer-send-button";
import { noop } from "../../../utils/noop";
import { isRequestPendingAtom, isStreamingAtom } from "../atoms/chat-atom";
import { useChat } from "../hooks/use-chat";
import { useComposerAttachments } from "../hooks/use-composer-attachments";
import { type ChatAttachmentRef } from "../schemas/chat-request";

type BaseProps = {
  agentInstanceId: number;
  // The active conversation (dwp multi-conversation) an in-place send targets.
  // Threaded from Collaboration (the URL `$conversationId`). Omitted on the DW
  // home (which parks + navigates via `onSubmit`) and for sico (v1).
  conversationId?: number;
  // The reconnect manager's hard idle exit, owned by Collaboration and threaded
  // down so Stop routes through it (G4). Optional so the Composer renders
  // standalone (stories/tests).
  reconnectStop?: () => void;
  // Override the send behavior. Receives the current draft text + ready
  // attachment refs so the starter can park-then-navigate instead of sending
  // in place (its index route has no mounted Collaboration to render the turn).
  // Omitted → the default in-place send.
  onSubmit?: (text: string, attachments: ChatAttachmentRef[]) => void;
  // A caller-owned async pre-step (the DW home's create-conversation, ~1.5s) is
  // in flight. Shows a spinner on the send button + disables input/resubmit so
  // the wait reads as "processing", not "frozen". Default false (chat page).
  submitting?: boolean;
};

// Controlled-draft escape hatch for the empty-state DigitalWorkerHome: the
// parent owns the text (so a suggested-task click can prefill it). A
// discriminated union enforces both-or-neither — passing only one is a compile
// error, never a silently-ignored prop. Omitting both → the Composer
// self-manages `draft` exactly as the pinned chat usage does.
type Props = BaseProps &
  (
    | { value: string; onChange: (value: string) => void }
    | { value?: undefined; onChange?: undefined }
  );

// A single white card owns the frame + focus ring: rest border sits at 10%
// (divider); hover and focus step it to 15% (input-stroke-rest) and focus also
// rises the shadow shadow-m→shadow-l (Figma 6893:48709).
// The has-[…control:focus-visible]:shadow-l re-states the @sico/ui shell's own
// focus rule (which forces shadow-s) so focus lands on shadow-l, not a doubled
// chrome; the control's inset focus line is killed separately in composer-input.tsx.
export function Composer({
  agentInstanceId,
  conversationId,
  reconnectStop,
  value,
  onChange,
  onSubmit,
  submitting = false,
}: Props): JSX.Element {
  const { send, stop, upload } = useChat(agentInstanceId, conversationId);
  const {
    attachments,
    anyUploading,
    fileError,
    addFile,
    removeAttachment,
    clear,
  } = useComposerAttachments(upload);
  // Controlled when the parent passes value+onChange; otherwise self-managed.
  // The discriminated `Props` union ties the two together, so checking `value`
  // alone narrows `onChange` to the setter too.
  const [internalDraft, setInternalDraft] = useState("");
  const isControlled = value !== undefined;
  const draft = isControlled ? value : internalDraft;
  const setDraft = isControlled ? onChange : setInternalDraft;
  const isStreaming = useAtomValue(isStreamingAtom);
  const isRequestPending = useAtomValue(isRequestPendingAtom);

  // Visibility = text present; enabled = nothing still uploading. Streaming/
  // pending precedence lives in the button.
  const hasText = draft.trim().length > 0;

  // A paste with files routes them through the same validate + upload path as
  // the picker; with NO files it falls through to the textarea's default text
  // handler — only preventDefault when we actually consume files.
  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of files) {
      addFile(file);
    }
  };

  const handleSubmit = (): void => {
    if (!hasText || anyUploading || submitting) {
      return;
    }
    // Only chips that finished uploading contribute their ref; still-uploading
    // ones are dropped.
    const refs = attachments.flatMap((a) =>
      a.status === "ready" && a.assetRef ? [a.assetRef] : [],
    );
    const text = draft;
    if (onSubmit) {
      // Caller-supplied submit (the home's create-then-park-then-navigate) owns
      // clearing + navigation. Do NOT clear here: on success the caller
      // navigates away (unmounting this Composer), and on failure the draft +
      // attachments must survive so the user's message isn't lost — clearing
      // here would drop attachments the caller can't restore (they live in this
      // Composer's internal state, not the caller's).
      onSubmit(text, refs);
      return;
    }
    // Default in-place send: clear the field immediately (the optimistic turn
    // renders below).
    setDraft("");
    clear();
    void send(text, refs, conversationId);
  };

  const handleStop = (): void => {
    // Plan-aware Stop: cancel a running plan first, then route teardown through
    // the reconnect manager's stop() (G4 — a bare abort re-opens the stream).
    void stop(reconnectStop ?? noop);
  };

  return (
    <div className="mx-auto flex w-full max-w-190 flex-col gap-2 px-4 pb-5">
      {fileError !== null && (
        <p role="alert" className="text-danger-700 px-2 text-sm">
          {fileError}
        </p>
      )}
      <InputGroup
        onPaste={handlePaste}
        className="border-divider bg-surface-basic shadow-m focus-within:border-input-stroke-rest focus-within:shadow-l hover:border-input-stroke-rest has-disabled:border-divider has-disabled:bg-surface-basic has-[[data-slot=input-group-control]:focus-visible]:border-input-stroke-rest has-[[data-slot=input-group-control]:focus-visible]:shadow-l min-h-30 rounded-2xl border pt-4 transition"
      >
        <AttachmentBar attachments={attachments} onRemove={removeAttachment} />
        <ComposerInput
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          disabled={isStreaming || isRequestPending || submitting}
        />
        <InputGroupAddon
          align="block-end"
          className="mt-1 justify-between px-2 pt-0 pb-2"
        >
          <ComposerAttachButton onAddFile={addFile} />
          <ComposerSendButton
            isStreaming={isStreaming}
            isRequestPending={isRequestPending}
            submitting={submitting}
            showSend={hasText}
            disabled={anyUploading}
            onSend={handleSubmit}
            onStop={handleStop}
          />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
