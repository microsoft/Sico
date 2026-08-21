import { type JSX } from "react";

import { FileTile } from "../../../../components/file-tile";
import type { MessageAttachment } from "../../atoms/chat-atom";
import { useSidepaneActions } from "../../hooks/use-sidepane";

export type FileAttachmentProps = {
  attachment: MessageAttachment;
};

// A sent non-image attachment: the shared `<FileTile>`, no remove control.
// With a `sasUrl` the tile opens the file in the sidepane (mirrors a deliverable
// card); without one (optional on the wire) it stays a static, read-only tile —
// there's no URL to preview.
export function FileAttachment({
  attachment,
}: FileAttachmentProps): JSX.Element {
  const { open } = useSidepaneActions();
  const { name, sasUrl } = attachment;
  const onActivate = sasUrl
    ? (): void => open({ kind: "file", filename: name, fileUrl: sasUrl })
    : undefined;

  return <FileTile filename={name} onActivate={onActivate} />;
}
