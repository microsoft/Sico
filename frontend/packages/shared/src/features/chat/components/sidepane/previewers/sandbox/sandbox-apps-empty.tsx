import type * as React from "react";

import { MessageState } from "../../../../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../../../../constants/empty-illustration";

// Empty state for the manage-apps table — no apps installed on the current
// device. Wraps the shared MessageState with sandbox-specific copy + the
// generic `cards` empty illustration.
const COPY = {
  heading: "No apps installed",
  body: "Apps will appear here.",
} as const;

export function SandboxAppsEmpty(): React.JSX.Element {
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.cards.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.cards.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.cards.height}
      heading={COPY.heading}
      body={COPY.body}
    />
  );
}
