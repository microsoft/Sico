import { type JSX } from "react";

import { ImageTile } from "../../../../components/image-tile";
import type { MessageAttachment } from "../../atoms/chat-atom";
import { useSidepaneActions } from "../../hooks/use-sidepane";

export type ImageAttachmentProps = {
  attachment: MessageAttachment;
};

// A sent image attachment: the shared `<ImageTile>` thumbnail. Source is the
// remote `sasUrl`, optional on the wire — a missing one falls back to empty src
// (broken thumbnail) and leaves the tile non-interactive (no URL to preview).
// With a `sasUrl` the tile opens the image in the sidepane as `file` content,
// which the FilePreviewer routes to the full-size ImageViewer by subtype.
export function ImageAttachment({
  attachment,
}: ImageAttachmentProps): JSX.Element {
  const { open } = useSidepaneActions();
  const { name, sasUrl } = attachment;
  const onActivate = sasUrl
    ? (): void => open({ kind: "file", filename: name, fileUrl: sasUrl })
    : undefined;

  return <ImageTile src={sasUrl ?? ""} alt={name} onActivate={onActivate} />;
}
