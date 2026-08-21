import { Button } from "@sico/ui";
import { Plus } from "lucide-react";
import type * as React from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";

const COPY = {
  heading: "Nothing here yet",
  body: "Projects hold your digital workers and their work.",
} as const;

export type EmptyStateProps = {
  // Opens the create-project dialog. Optional so the empty state still renders
  // read-only where no create affordance is wanted.
  onCreate?: () => void;
};

/** Empty state for `/project` — offers a "Create project" CTA when `onCreate`
 * is provided (copy mirrors the PR346 design draft). */
export function EmptyState({
  onCreate,
}: EmptyStateProps = {}): React.JSX.Element {
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.projects.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.projects.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.projects.height}
      heading={COPY.heading}
      body={COPY.body}
      action={
        onCreate ? (
          <Button variant="primary" onClick={onCreate}>
            <Plus aria-hidden="true" />
            Create Project
          </Button>
        ) : undefined
      }
    />
  );
}
