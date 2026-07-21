import { type ReactElement } from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

const COPY = {
  heading: "No digital workers yet",
  body: "Create a digital worker to get started.",
} as const;

/** Empty state for `/studio` when there are zero agents. */
export function StudioEmpty(): ReactElement {
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.people.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.people.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.people.height}
      heading={COPY.heading}
      body={COPY.body}
    />
  );
}
