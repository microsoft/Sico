import type * as React from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

const COPY = {
  heading: "Nothing here yet",
  body: "Projects hold your digital workers and their work.",
} as const;

/** Empty state for `/project`. The create affordance is intentionally omitted —
 * projects are provisioned outside the dashboard. */
export function EmptyState(): React.JSX.Element {
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.projects.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.projects.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.projects.height}
      heading={COPY.heading}
      body={COPY.body}
    />
  );
}
