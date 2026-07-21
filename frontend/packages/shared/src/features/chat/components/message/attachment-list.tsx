import { type JSX } from "react";

import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { isImageFilename } from "../../../../utils/file-type";
import type { MessageAttachment } from "../../atoms/chat-atom";

export type AttachmentListProps = {
  attachments: MessageAttachment[];
};

// Read-only attachment strip on a sent bubble — the editable composer
// AttachmentBar is a separate component.
export function AttachmentList({
  attachments,
}: AttachmentListProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {attachments.map((attachment) =>
        isImageFilename(attachment.name) ? (
          <ImageAttachment
            key={attachment.id ?? attachment.uri}
            attachment={attachment}
          />
        ) : (
          <FileAttachment
            key={attachment.id ?? attachment.uri}
            attachment={attachment}
          />
        ),
      )}
    </div>
  );
}
