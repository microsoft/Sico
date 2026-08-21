import {
  Button,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { FolderCheck, FolderPlus } from "lucide-react";
import { type JSX } from "react";

import { useAgentQuery } from "../../../digital-worker/hooks/use-agents-query";
import { useAddDeliverableToProject } from "../../../projects/hooks/use-add-deliverable-to-project";
import { useChatAgentId } from "../../services/chat-agent-context";

export type AddToProjectButtonProps = {
  // The blob-relative uri (wire `file.fileUri`) the publish addresses by. Empty
  // when the deliverable carries no addressable uri — the action then disables.
  fileUri: string;
  filename: string;
};

const COPY = {
  add: "Add to project",
  added: "Added to project",
} as const;

/**
 * Header action on a chat deliverable preview: publishes the file into the DW's
 * owning project (`POST /project/deliverable`). The projectId comes from the
 * agent detail (the active conversation's `agentInstanceId`, read from context);
 * the `fileUri` is the wire `file.fileUri`, provided directly by the backend. A
 * non-suspense query keeps the preview from blocking on the agent fetch — the
 * action is disabled until the project resolves. On success a toast offers a View
 * link to the project's deliverables, and the button stays disabled (the publish
 * is terminal — a second click would create a duplicate asset).
 */
export function AddToProjectButton({
  fileUri,
  filename,
}: AddToProjectButtonProps): JSX.Element {
  const agentInstanceId = useChatAgentId();
  const navigate = useNavigate();
  const { data: agent } = useAgentQuery(agentInstanceId);
  const add = useAddDeliverableToProject();
  const projectId = agent?.project?.id;

  const handleAdd = (): void => {
    if (projectId === undefined || fileUri === "" || add.isSuccess) {
      return;
    }
    add.mutate(
      {
        projectId,
        agentInstanceId,
        fileUri,
        fileName: filename,
      },
      {
        onSuccess: () => {
          toast.success("File shared. Everyone in the project can access.", {
            action: {
              label: "View",
              onClick: () => {
                void navigate({
                  to: "/project/$projectId/deliverable",
                  params: { projectId: String(projectId) },
                });
              },
            },
          });
        },
        onError: () => {
          toast.error("We couldn't add this to the project. Try again.");
        },
      },
    );
  };

  const label = add.isSuccess ? COPY.added : COPY.add;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="subtle"
            size="icon-xs"
            aria-label={label}
            aria-disabled={add.isSuccess || undefined}
            disabled={
              !add.isSuccess &&
              (projectId === undefined || fileUri === "" || add.isPending)
            }
            className={add.isSuccess ? "pointer-events-none" : undefined}
            onClick={handleAdd}
          >
            {add.isSuccess ? (
              <FolderCheck className="size-4" />
            ) : (
              <FolderPlus className="size-4" />
            )}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
