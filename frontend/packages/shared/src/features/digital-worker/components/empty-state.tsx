import { Button } from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { Plus } from "lucide-react";
import { type ReactElement } from "react";

import { MessageState } from "../../../components/message-state";
import { EMPTY_ILLUSTRATIONS } from "../../../constants/empty-illustration";
import { createProjectDialogOpenAtom } from "../../projects/atoms/create-project-dialog-atom";

const HEADING = "Your crew is one hire away";
const NO_PROJECT_BODY = "You need a project before adding a digital worker.";
const HAS_PROJECT_BODY = "Add your first digital worker to get started.";

export type EmptyStateProps = {
  // Whether the user has at least one project. Without one, adding a DW is
  // impossible (the instance must be linked to a project), so the CTA routes to
  // project creation instead of opening the Add DW dialog.
  hasProject?: boolean;
  // While the projects query is still loading we don't yet know `hasProject`,
  // so the CTA is suppressed to avoid flashing the wrong button.
  projectsLoading?: boolean;
  // Opens the Add DW dialog (only used when `hasProject`).
  onAddDw?: () => void;
};

/** Empty state for `/digital-worker`. Offers an "Add digital worker" CTA when
 * the user has a project; otherwise a "Create project" CTA that navigates to
 * `/project` and raises the create dialog via a jotai atom (copy mirrors the
 * PR346 design draft). */
export function EmptyState({
  hasProject = false,
  projectsLoading = false,
  onAddDw,
}: EmptyStateProps = {}): ReactElement {
  const navigate = useNavigate();
  const setCreateProjectOpen = useSetAtom(createProjectDialogOpenAtom);
  const goCreateProject = (): void => {
    setCreateProjectOpen(true);
    void navigate({ to: "/project" });
  };
  let action: ReactElement | undefined;
  if (projectsLoading) {
    action = undefined;
  } else if (hasProject) {
    action = (
      <Button variant="primary" onClick={onAddDw}>
        <Plus aria-hidden="true" />
        Add Digital Worker
      </Button>
    );
  } else {
    action = (
      <Button variant="primary" onClick={goCreateProject}>
        <Plus aria-hidden="true" />
        Create Project
      </Button>
    );
  }
  return (
    <MessageState
      fill
      illustrationUrl={EMPTY_ILLUSTRATIONS.people.url}
      illustrationWidth={EMPTY_ILLUSTRATIONS.people.width}
      illustrationHeight={EMPTY_ILLUSTRATIONS.people.height}
      heading={HEADING}
      body={hasProject || projectsLoading ? HAS_PROJECT_BODY : NO_PROJECT_BODY}
      action={action}
    />
  );
}
