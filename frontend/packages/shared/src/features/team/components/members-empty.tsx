import type * as React from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

// Per-tab empty copy — the roster is fixed (no pagination), so a zero-length
// list means the project simply has no humans / digital workers yet.
const EMPTY_COPY = {
  humans: {
    heading: "No members yet",
    body: "Invite people to collaborate on this project.",
  },
  workers: {
    heading: "No digital workers yet",
    body: "Add digital workers to put them to work on this project.",
  },
} as const;

export type MembersEmptyProps = {
  variant: "humans" | "workers";
};

/**
 * Empty surface for the two member tables, on the shared `MessageState`
 * primitive with the `people` illustration. Mirrors the assets-table empty
 * pattern: heading + a variant-specific body line.
 */
export function MembersEmpty({
  variant,
}: MembersEmptyProps): React.JSX.Element {
  const copy = EMPTY_COPY[variant];
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.people.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.people.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.people.height}
      heading={copy.heading}
      body={copy.body}
    />
  );
}
