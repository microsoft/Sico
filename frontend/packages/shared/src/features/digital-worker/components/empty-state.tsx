import { type ReactElement } from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

const HEADING = "Your crew is one hire away";
const BODY = "Add your first digital worker to get started.";

/** Empty state for `/digital-worker`. The create affordance is intentionally
 * omitted — digital workers are provisioned outside the dashboard. */
export function EmptyState(): ReactElement {
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.people.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.people.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.people.height}
      heading={HEADING}
      body={BODY}
    />
  );
}
