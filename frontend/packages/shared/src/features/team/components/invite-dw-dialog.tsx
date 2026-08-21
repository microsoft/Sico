import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldGroup,
  toast,
} from "@sico/ui";
import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import type * as React from "react";
import { useForm } from "react-hook-form";

import { userAtom } from "../../../atoms/auth-atom";
import { apiErrorMessage } from "../../../utils/api-error-message";
import {
  ADD_DW_INITIAL_VALUES,
  addDwSchema,
  type AddDwValues,
  renderAvatarField,
  renderDwField,
  renderNameField,
} from "../../digital-worker/components/add-dw-fields";
import { useCreateAgentInstanceMutation } from "../../digital-worker/hooks/use-create-agent-mutation";
import { deriveState } from "../../digital-worker/utils/load-state";
import { useAgentInfosQuery } from "../../studio/hooks/use-agent-infos-query";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";

export type InviteDwDialogProps = {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Add a digital worker to THIS project (module3). Reuses the Add DW field
 * renderers but drops the project select — `projectId` comes from the route and
 * is seeded into the form (kept for renderer type-compat) then injected into the
 * create call. RHF + zodResolver + `@sico/ui` Field. */
export function InviteDwDialog({
  projectId,
  open,
  onOpenChange,
}: InviteDwDialogProps): React.JSX.Element {
  const user = useAtomValue(userAtom);
  const templatesQuery = useAgentInfosQuery();
  const templates = templatesQuery.data ?? [];
  const templatesState = deriveState(
    templatesQuery.isPending,
    templatesQuery.isError,
    templates.length,
  );
  // Seed projectId from the route so the select field can be omitted while the
  // shared renderers (typed to AddDwValues) still receive a compatible form.
  const initial: AddDwValues = useMemo(
    () => ({ ...ADD_DW_INITIAL_VALUES, projectId: String(projectId) }),
    [projectId],
  );
  const form = useForm<AddDwValues>({
    resolver: zodResolver(addDwSchema),
    defaultValues: initial,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const mutation = useCreateAgentInstanceMutation();

  useEffect(() => {
    if (open) {
      form.reset(initial);
    }
  }, [open, form, initial]);

  const handlePick = (card: SingleAgentCard | undefined): void => {
    if (card && !form.getFieldState("name").isDirty) {
      form.setValue("name", card.name);
    }
  };

  const onSubmit = (values: AddDwValues): void => {
    if (!user?.email) {
      toast.error("You must be signed in to add a digital worker.");
      return;
    }
    const role = templates.find((t) => t.agentId === values.agentId)?.role;
    mutation.mutate(
      {
        agentId: values.agentId,
        name: values.name,
        role,
        iconUri: values.iconUri,
        employerUsername: user.email,
        projectId,
      },
      {
        onSuccess: () => {
          toast.success("Digital Worker added.", { invert: true });
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(error, "We couldn't add the digital worker."),
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="content" className="w-150">
        <DialogHeader>
          <DialogTitle>Add Digital Worker</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            {renderDwField(form.control, templates, templatesState, handlePick)}
            {renderNameField(form.control)}
            {renderAvatarField(form.control)}
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="subtle"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              aria-busy={mutation.isPending}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
