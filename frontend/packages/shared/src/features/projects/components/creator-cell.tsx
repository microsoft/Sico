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
        <span className="leading-body text-foreground-primary min-w-0 flex-1 truncate">
          {creator.agentName ?? "Digital worker"}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <UserAvatar user={{ name: creator.username }} size="sm" decorative />
      <span className="leading-body text-foreground-primary min-w-0 flex-1 truncate">
        {creator.username}
      </span>
    </div>
  );
}
