import type * as React from "react";

import { DwAvatar } from "../../../components/dw-avatar/dw-avatar";
import { UserAvatar } from "../../../components/user-avatar/user-avatar";
import type { AssetCreator } from "../types";

export type CreatorCellProps = {
  creator: AssetCreator;
};

/**
 * CREATOR column cell for the assets table. The creator is a two-subject
 * discriminated union (`AssetCreator`):
 *
 * - **Knowledge** docs are uploaded by a human → `<UserAvatar>` plus the
 *   username as visible text. The avatar is `decorative` so screen readers
 *   announce the name once (the text), not twice.
 * - **Experience** playbooks / **Deliverables** are authored by a Digital
 *   Worker → `<DwAvatar>` plus the DW name. The name rides on the wire
 *   (`extraInfo.agentInstance.agentName`); a missing name (older rows) falls
 *   back to the generic "Digital worker" label so the cell never renders blank.
 */
export function CreatorCell({ creator }: CreatorCellProps): React.JSX.Element {
  if (creator.kind === "agent") {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <DwAvatar agent={{ iconUri: creator.iconUrl }} size="sm" decorative />
        <span className="text-foreground-primary leading-body min-w-0 flex-1 truncate">
          {creator.agentName ?? "Digital worker"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <UserAvatar user={{ name: creator.username }} size="sm" decorative />
      <span className="text-foreground-primary leading-body min-w-0 flex-1 truncate">
        {creator.username}
      </span>
    </div>
  );
}
