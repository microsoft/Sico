import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@sico/ui";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type * as React from "react";

import { FIELD_LABEL_CLASS } from "../../../constants/form";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { useReassignAgentMutation } from "../../digital-worker/hooks/use-reassign-agent-mutation";
import { useProjectMembersQuery } from "../hooks/use-project-members-query";

export type ReassignDwDialogProps = {
  projectId: number;
  agentId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Reassign a digital worker to a new operator (module3). Operators are the
 * project's members; the selected member's email becomes `newOperatorUsername`. */
export function ReassignDwDialog({
  projectId,
  agentId,
  open,
  onOpenChange,
}: ReassignDwDialogProps): React.JSX.Element {
  const membersQuery = useProjectMembersQuery(projectId);
  const members = membersQuery.data ?? [];
  const mutation = useReassignAgentMutation();
  const [operator, setOperator] = useState<string>("");

  // Dialog operations surface load failures as a toast (not inline) — the
  // operator dropdown just can't be populated, so tell the user why on open.
  const membersError = open && membersQuery.isError;
  useEffect(() => {
    if (membersError) {
      toast.error("We couldn't load members. Try reopening the dialog.");
    }
  }, [membersError]);

  // Placeholder mirrors the members-query state so the operator dropdown isn't a
  // silent empty control while loading / on error / when the project has none.
  let placeholder = "Select a member…";
  if (membersQuery.isPending) {
    placeholder = "Loading members…";
  } else if (membersQuery.isError) {
    placeholder = "Couldn't load members";
  } else if (members.length === 0) {
    placeholder = "No members to reassign to";
  }

  const onConfirm = (): void => {
    if (!operator) {
      return;
    }
    mutation.mutate(
      { id: agentId, newOperatorUsername: operator },
      {
        onSuccess: () => {
          toast.success("Digital Worker reassigned.", { invert: true });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(error, "We couldn't reassign this worker."),
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>Reassign Digital Worker</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="reassign-operator" className={FIELD_LABEL_CLASS}>
            New operator
          </FieldLabel>
          <Select
            items={members.map((member) => ({
              value: member.email,
              label: member.alias ?? member.email,
            }))}
            value={operator || null}
            onValueChange={(next) => setOperator(next ?? "")}
            disabled={membersQuery.isPending || membersQuery.isError}
          >
            <SelectTrigger id="reassign-operator" className="w-full">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.email}>
                  {member.alias ?? member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="subtle"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            aria-busy={mutation.isPending}
            disabled={mutation.isPending || !operator}
            onClick={onConfirm}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
            {mutation.isPending ? "Reassigning…" : "Reassign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
