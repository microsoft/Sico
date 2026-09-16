import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from "@sico/ui";
import { type JSX } from "react";

import { safeIconUri } from "../../../utils/safe-icon-uri";

export function OrganizationAvatar({
  name,
  iconUrl,
  size = "xs",
}: {
  name: string;
  iconUrl?: string | null;
  size?: AvatarSize;
}): JSX.Element {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const src = safeIconUri(iconUrl ?? undefined);
  return (
    <Avatar
      key={src ?? "initial"}
      size={size}
      className="rounded-md after:rounded-md"
      data-testid="organization-avatar"
    >
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="rounded-md"
          data-testid="organization-avatar-image"
        />
      ) : null}
      <AvatarFallback className="rounded-md">{initial}</AvatarFallback>
    </Avatar>
  );
}
