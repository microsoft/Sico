import { type JSX } from "react";

import { AttachmentChip } from "./attachment-chip";
import { type Attachment } from "../atoms/chat-atom";

type Props = {
  attachments: Attachment[];
  onRemove: (localId: string) => void;
};

export function AttachmentBar({
  attachments,
  onRemove,
}: Props): JSX.Element | null {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="mb-3 flex w-full flex-wrap items-center gap-2 px-4">
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.localId}
          attachment={attachment}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
